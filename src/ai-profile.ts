import { z } from "zod";

import {
  canonicalizeDefaultPrompt,
  createDefaultAiPrompts,
  localizeDefaultPrompt,
} from "./ai-prompts.js";

export {
  type AiProfileCompatibilityStatus,
  assessModelCompatibility,
} from "./ai-profile-compatibility.js";

const identifierSchema = z.string().min(1).max(256);
export const supportedProfileLanguages = [
  "auto",
  "ar",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "en-GB",
  "en-US",
  "es",
  "es-ES",
  "es-MX",
  "fi",
  "fr",
  "fr-CA",
  "he",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-CN",
  "zh-TW",
] as const;
export const profileLanguageSchema = z.enum(supportedProfileLanguages);
export type ProfileLanguage = z.infer<typeof profileLanguageSchema>;
const modelSchema = z.string().trim().min(1).max(256).nullable();
const promptSchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => value.trim().length > 0, "The prompt cannot contain only whitespace")
  .nullable();
const generationSchema = z
  .object({
    seed: z.number().int().optional(),
    temperature: z.number().min(0).max(2).optional(),
    think: z.boolean().optional(),
  })
  .default({});

const automaticNumberSchema = <T extends z.ZodNumber>(schema: T) =>
  z.union([z.literal("auto"), schema]);

export const externalVadSchema = z
  .object({
    enabled: z.boolean().default(true),
    minSilenceDurationMs: z.number().int().min(32).max(10_000).default(768),
    minSpeechDurationMs: z.number().int().min(32).max(2_000).default(96),
    negativeSpeechThreshold: automaticNumberSchema(z.number().min(0).max(1)).default("auto"),
    speechPadMs: z.number().int().min(0).max(5_000).default(96),
    threshold: z.number().min(0.15).max(1).default(0.5),
  })
  .prefault({});

export const localVadSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxSpeechDurationSeconds: automaticNumberSchema(z.number().positive().max(86_400)).default(
      "auto",
    ),
    minSilenceDurationMs: automaticNumberSchema(z.number().int().min(0).max(10_000)).default(
      "auto",
    ),
    minSpeechDurationMs: z.number().int().min(0).max(2_000).default(0),
    negativeSpeechThreshold: automaticNumberSchema(z.number().min(0).max(1)).default("auto"),
    speechPadMs: z.number().int().min(0).max(5_000).default(400),
    threshold: z.number().min(0).max(1).default(0.5),
  })
  .prefault({});

const transcriptionBaseSchema = z.object({
  interSpeechSilenceMs: z.number().int().min(0).max(5_000).default(0),
  language: profileLanguageSchema.default("auto"),
  mergeMaxGapMs: z.number().int().min(0).max(30_000).default(2_000),
  model: modelSchema.default(null),
  prompt: promptSchema,
  providerOptions: z.record(z.string().min(1), z.record(z.string().min(1), z.json())).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

const refinementBaseSchema = z.object({
  generation: generationSchema,
  maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
  model: modelSchema.default(null),
  prompt: promptSchema,
});

const summaryBaseSchema = z.object({
  consolidationPrompt: promptSchema,
  extractionPrompt: promptSchema,
  generation: generationSchema,
  maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
  model: modelSchema.default(null),
});

export const externalTranscriptionAiProfileSchema = transcriptionBaseSchema.extend({
  provider: z.literal("openrouter").default("openrouter"),
  vad: externalVadSchema,
});
export const localTranscriptionAiProfileSchema = transcriptionBaseSchema.extend({
  batchSize: z.union([z.literal("auto"), z.number().int().min(0).max(64)]).default("auto"),
  provider: z.literal("faster-whisper").default("faster-whisper"),
  vad: localVadSchema,
});
export const externalRefinementAiProfileSchema = refinementBaseSchema.extend({
  provider: z.literal("openrouter").default("openrouter"),
});
export const localRefinementAiProfileSchema = refinementBaseSchema.extend({
  provider: z.literal("ollama").default("ollama"),
});
export const externalSummaryAiProfileSchema = summaryBaseSchema.extend({
  provider: z.literal("openrouter").default("openrouter"),
});
export const localSummaryAiProfileSchema = summaryBaseSchema.extend({
  provider: z.literal("ollama").default("ollama"),
});
const profileBaseShape = {
  language: profileLanguageSchema.default("auto"),
  name: z.string().trim().min(1).max(100),
  profileId: identifierSchema,
};
export const externalAiProfileSchema = z
  .object({
    ...profileBaseShape,
    profileType: z.literal("external"),
    refinement: externalRefinementAiProfileSchema,
    summary: externalSummaryAiProfileSchema,
    transcription: externalTranscriptionAiProfileSchema,
  })
  .strict();
export const localAiProfileSchema = z
  .object({
    ...profileBaseShape,
    profileType: z.literal("local"),
    refinement: localRefinementAiProfileSchema,
    summary: localSummaryAiProfileSchema,
    transcription: localTranscriptionAiProfileSchema,
  })
  .strict();
export const aiProfileSchema = z.discriminatedUnion("profileType", [
  externalAiProfileSchema,
  localAiProfileSchema,
]);

export type AiProfile = z.infer<typeof aiProfileSchema>;
export type AiProfileType = AiProfile["profileType"];

export function createInitialAiProfile(
  profileType: AiProfileType,
  dashboardLanguage: "en" | "pt-BR",
): AiProfile {
  const localizedName = dashboardLanguage === "pt-BR" ? "Perfil 1" : "Profile 1";
  const prompts = createDefaultAiPrompts(dashboardLanguage, "auto");
  const providerSelection =
    profileType === "external"
      ? {
          refinement: {
            model: null,
            prompt: prompts.refinement,
            provider: "openrouter" as const,
          },
          summary: {
            consolidationPrompt: prompts.summaryConsolidation,
            extractionPrompt: prompts.summaryExtraction,
            model: null,
            provider: "openrouter" as const,
          },
          transcription: { model: null, prompt: null, provider: "openrouter" as const },
        }
      : {
          refinement: {
            model: null,
            prompt: prompts.refinement,
            provider: "ollama" as const,
          },
          summary: {
            consolidationPrompt: prompts.summaryConsolidation,
            extractionPrompt: prompts.summaryExtraction,
            model: null,
            provider: "ollama" as const,
          },
          transcription: { model: null, prompt: null, provider: "faster-whisper" as const },
        };
  return aiProfileSchema.parse({
    name: localizedName,
    profileId: `${profileType}-profile-1`,
    profileType,
    ...providerSelection,
  });
}

export function localizeAiProfileDefaults(
  profile: AiProfile,
  dashboardLanguage: "en" | "pt-BR",
): AiProfile {
  const summaryPromptLanguage = getSummaryPromptLanguage(profile);
  return aiProfileSchema.parse({
    ...profile,
    refinement: {
      ...profile.refinement,
      prompt: localizeDefaultPrompt(
        profile.refinement.prompt,
        "refinement",
        dashboardLanguage,
        profile.language,
      ),
    },
    summary: {
      ...profile.summary,
      consolidationPrompt: localizeDefaultPrompt(
        profile.summary.consolidationPrompt,
        "summaryConsolidation",
        dashboardLanguage,
        summaryPromptLanguage,
      ),
      extractionPrompt: localizeDefaultPrompt(
        profile.summary.extractionPrompt,
        "summaryExtraction",
        dashboardLanguage,
        summaryPromptLanguage,
      ),
    },
  });
}

export function canonicalizeAiProfileDefaults(profile: AiProfile): AiProfile {
  const summaryPromptLanguage = getSummaryPromptLanguage(profile);
  return aiProfileSchema.parse({
    ...profile,
    refinement: {
      ...profile.refinement,
      prompt: canonicalizeDefaultPrompt(profile.refinement.prompt, "refinement", profile.language),
    },
    summary: {
      ...profile.summary,
      consolidationPrompt: canonicalizeDefaultPrompt(
        profile.summary.consolidationPrompt,
        "summaryConsolidation",
        summaryPromptLanguage,
      ),
      extractionPrompt: canonicalizeDefaultPrompt(
        profile.summary.extractionPrompt,
        "summaryExtraction",
        summaryPromptLanguage,
      ),
    },
  });
}

export function isAiProfileComplete(profile: AiProfile): boolean {
  return [profile.transcription, profile.refinement, profile.summary].every(
    (phase) => phase.model !== null,
  );
}

export function resolveAiProfile(profile: AiProfile) {
  if (!isAiProfileComplete(profile)) {
    throw new Error("The active AI profile is incomplete");
  }
  const transcription = requireCompletePhase(profile.transcription);
  const refinement = requireCompletePhase(profile.refinement);
  const summary = requireCompletePhase(profile.summary);
  const summaryPromptLanguage = getSummaryPromptLanguage(profile);
  return {
    language: profile.language,
    profileType: profile.profileType,
    refinement: {
      generation: refinement.generation,
      maxChunkCharacters: refinement.maxChunkCharacters,
      model: refinement.model,
      prompt: canonicalizeDefaultPrompt(refinement.prompt, "refinement", profile.language),
      provider: refinement.provider,
    },
    summary: {
      consolidationPrompt: canonicalizeDefaultPrompt(
        summary.consolidationPrompt,
        "summaryConsolidation",
        summaryPromptLanguage,
      ),
      extractionPrompt: canonicalizeDefaultPrompt(
        summary.extractionPrompt,
        "summaryExtraction",
        summaryPromptLanguage,
      ),
      generation: summary.generation,
      maxChunkCharacters: summary.maxChunkCharacters,
      model: summary.model,
      provider: summary.provider,
    },
    transcription: {
      interSpeechSilenceMs: transcription.interSpeechSilenceMs,
      language: transcription.language,
      mergeMaxGapMs: transcription.mergeMaxGapMs,
      model: transcription.model,
      prompt: transcription.prompt ?? null,
      provider: transcription.provider,
      ...(transcription.providerOptions === undefined
        ? {}
        : { providerOptions: transcription.providerOptions }),
      ...(transcription.temperature === undefined
        ? {}
        : { temperature: transcription.temperature }),
      ...(transcription.provider === "faster-whisper"
        ? { batchSize: transcription.batchSize }
        : {}),
      vad: transcription.vad,
    },
  };
}

function getSummaryPromptLanguage(profile: AiProfile): ProfileLanguage {
  return profile.language === "auto" ? profile.transcription.language : profile.language;
}

function requireCompletePhase<T extends { model: string | null; provider: string }>(
  phase: T,
): T & { model: string } {
  if (phase.model === null) {
    throw new Error("The active AI profile is incomplete");
  }
  return { ...phase, model: phase.model };
}
