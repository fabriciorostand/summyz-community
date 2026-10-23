import { z } from "zod";
import { createDefaultAiPrompts } from "./ai-prompts.js";

export {
  type AiProfileCompatibilityStatus,
  assessModelCompatibility,
} from "./ai-profile-compatibility.js";

const identifierSchema = z.string().min(1).max(256);
export const localAiDeviceSchema = z.enum(["auto", "cpu", "gpu"]);
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
  device: z.never().optional(),
  provider: z.literal("openrouter").default("openrouter"),
  vad: externalVadSchema,
});
export const localTranscriptionAiProfileSchema = transcriptionBaseSchema.extend({
  device: localAiDeviceSchema.default("auto"),
  batchSize: z.union([z.literal("auto"), z.number().int().min(0).max(64)]).default("auto"),
  provider: z.literal("faster-whisper").default("faster-whisper"),
  vad: localVadSchema,
});
export const externalRefinementAiProfileSchema = refinementBaseSchema.extend({
  device: z.never().optional(),
  provider: z.literal("openrouter").default("openrouter"),
});
export const localRefinementAiProfileSchema = refinementBaseSchema.extend({
  device: localAiDeviceSchema.default("auto"),
  provider: z.literal("ollama").default("ollama"),
});
export const externalSummaryAiProfileSchema = summaryBaseSchema.extend({
  device: z.never().optional(),
  provider: z.literal("openrouter").default("openrouter"),
});
export const localSummaryAiProfileSchema = summaryBaseSchema.extend({
  device: localAiDeviceSchema.default("auto"),
  provider: z.literal("ollama").default("ollama"),
});
export const promptModesSchema = z
  .object({
    transcription: z.enum(["default", "custom"]),
    refinement: z.enum(["default", "custom"]),
    summaryExtraction: z.enum(["default", "custom"]),
    summaryConsolidation: z.enum(["default", "custom"]),
  })
  .strict();

const profileBaseShape = {
  promptModes: promptModesSchema,
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
export const profileSelectionShape = {
  refinement: z.discriminatedUnion("provider", [
    externalRefinementAiProfileSchema,
    localRefinementAiProfileSchema,
    refinementBaseSchema.extend({ provider: z.null() }),
  ]),
  summary: z.discriminatedUnion("provider", [
    externalSummaryAiProfileSchema,
    localSummaryAiProfileSchema,
    summaryBaseSchema.extend({ provider: z.null() }),
  ]),
  transcription: z.discriminatedUnion("provider", [
    externalTranscriptionAiProfileSchema,
    localTranscriptionAiProfileSchema,
    transcriptionBaseSchema.extend({ provider: z.null(), vad: externalVadSchema }),
  ]),
};

export function calculateProfileType(profile: {
  transcription: { provider: string | null };
  refinement: { provider: string | null };
  summary: { provider: string | null };
}): "external" | "local" | "hybrid" | null {
  const providers = [
    profile.transcription.provider,
    profile.refinement.provider,
    profile.summary.provider,
  ];
  if (providers.includes(null)) return null;
  if (providers.every((provider) => provider === "openrouter")) return "external";
  if (providers.every((provider) => provider !== "openrouter")) return "local";
  return "hybrid";
}

export const aiProfileInputSchema = z
  .object({
    ...profileBaseShape,
    ...profileSelectionShape,
    profileType: z.unknown().optional(),
  })
  .strict();
export const aiProfileSchema = aiProfileInputSchema.transform((profile) => {
  const language = profile.language === "auto" ? profile.transcription.language : profile.language;
  const defaults = createDefaultAiPrompts(language);
  return {
    ...profile,
    profileType: calculateProfileType(profile),
    transcription: {
      ...profile.transcription,
      prompt:
        profile.promptModes.transcription === "default"
          ? defaults.transcription
          : profile.transcription.prompt,
    },
    refinement: {
      ...profile.refinement,
      prompt:
        profile.promptModes.refinement === "default"
          ? defaults.refinement
          : profile.refinement.prompt,
    },
    summary: {
      ...profile.summary,
      extractionPrompt:
        profile.promptModes.summaryExtraction === "default"
          ? defaults.summaryExtraction
          : profile.summary.extractionPrompt,
      consolidationPrompt:
        profile.promptModes.summaryConsolidation === "default"
          ? defaults.summaryConsolidation
          : profile.summary.consolidationPrompt,
    },
  };
});

export function createEmptyInitialAiProfile(setupLanguage: "en" | "pt-BR"): AiProfile {
  const base = createInitialAiProfile("external", setupLanguage);
  return aiProfileSchema.parse({
    ...base,
    profileId: "default-profile-1",
    transcription: { ...base.transcription, provider: null },
    refinement: { ...base.refinement, provider: null },
    summary: { ...base.summary, provider: null },
  });
}

export type AiProfile = z.infer<typeof aiProfileSchema>;
export type AiProfileType = AiProfile["profileType"];

export function createInitialAiProfile(
  profileType: "external" | "local",
  setupLanguage: "en" | "pt-BR",
): AiProfile {
  const localizedName = setupLanguage === "pt-BR" ? "Perfil 1" : "Profile 1";
  const prompts = createDefaultAiPrompts("auto");
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
    promptModes: {
      transcription: "default",
      refinement: "default",
      summaryExtraction: "default",
      summaryConsolidation: "default",
    },
    name: localizedName,
    profileId: `${profileType}-profile-1`,
    profileType,
    ...providerSelection,
  });
}

export function isAiProfileComplete(profile: AiProfile): boolean {
  return [profile.transcription, profile.refinement, profile.summary].every(
    (phase) => phase.model !== null && phase.provider !== null,
  );
}

export function resolveAiProfile(input: AiProfile) {
  const profile = aiProfileSchema.parse(input);
  if (!isAiProfileComplete(profile)) {
    throw new Error("The active AI profile is incomplete");
  }
  const transcription = requireCompletePhase(profile.transcription);
  const refinement = requireCompletePhase(profile.refinement);
  const summary = requireCompletePhase(profile.summary);
  return {
    language: profile.language,
    profileType: profile.profileType,
    refinement: {
      generation: refinement.generation,
      maxChunkCharacters: refinement.maxChunkCharacters,
      model: refinement.model,
      prompt: refinement.prompt,
      provider: refinement.provider,
      ...(refinement.provider === "ollama" ? { device: refinement.device } : {}),
    },
    summary: {
      consolidationPrompt: summary.consolidationPrompt,
      extractionPrompt: summary.extractionPrompt,
      generation: summary.generation,
      maxChunkCharacters: summary.maxChunkCharacters,
      model: summary.model,
      provider: summary.provider,
      ...(summary.provider === "ollama" ? { device: summary.device } : {}),
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
        ? { batchSize: transcription.batchSize, device: transcription.device }
        : {}),
      vad: transcription.vad,
    },
  };
}

function requireCompletePhase<T extends { model: string | null; provider: string | null }>(
  phase: T,
): T & { model: string; provider: string } {
  if (phase.model === null || phase.provider === null) {
    throw new Error("The active AI profile is incomplete");
  }
  return { ...phase, model: phase.model, provider: phase.provider };
}
