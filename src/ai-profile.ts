import { z } from "zod";

import { createDefaultAiPrompts } from "./ai-prompts.js";
import type { LocalHardwareProfile } from "./local-ai/hardware-profile.js";

const identifierSchema = z.string().min(1).max(256);
const languageSchema = z.string().min(1).max(32);
const modelSchema = z.string().trim().min(1).max(256).nullable();
const promptSchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => value.trim().length > 0, "The prompt cannot contain only whitespace")
  .nullable()
  .optional();
const generationSchema = z
  .object({
    seed: z.number().int().optional(),
    temperature: z.number().min(0).max(2).optional(),
    think: z.boolean().optional(),
  })
  .default({});

export const transcriptionAiProfileSchema = z.object({
  batchSize: z.union([z.literal("auto"), z.number().int().min(0).max(64)]).default("auto"),
  interSpeechSilenceMs: z.number().int().min(0).max(5_000).default(0),
  language: languageSchema.default("auto"),
  mergeMaxGapMs: z.number().int().min(0).max(30_000).default(2_000),
  model: modelSchema.default(null),
  prompt: promptSchema,
  provider: z.enum(["faster-whisper", "openrouter"]).nullable().default(null),
  providerOptions: z.record(z.string().min(1), z.record(z.string().min(1), z.json())).optional(),
  temperature: z.number().min(0).max(1).optional(),
  timestampMode: z.enum(["batch", "word"]).default("word"),
});

export const refinementAiProfileSchema = z.object({
  generation: generationSchema,
  maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
  model: modelSchema.default(null),
  prompt: promptSchema,
  provider: z.enum(["ollama", "openrouter"]).nullable().default(null),
});

export const summaryAiProfileSchema = z.object({
  consolidationPrompt: promptSchema,
  extractionPrompt: promptSchema,
  generation: generationSchema,
  language: languageSchema.default("auto"),
  maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
  model: modelSchema.default(null),
  provider: z.enum(["ollama", "openrouter"]).nullable().default(null),
});

export const aiProfileSchema = z.object({
  guildId: identifierSchema,
  name: z.string().trim().min(1).max(100),
  profileId: identifierSchema,
  refinement: refinementAiProfileSchema,
  summary: summaryAiProfileSchema,
  transcription: transcriptionAiProfileSchema,
});

export type AiProfile = z.infer<typeof aiProfileSchema>;
export type AiProfileCompatibilityStatus =
  | "above_recommended"
  | "compatible"
  | "incompatible"
  | "recommended"
  | "unknown";

interface InitialAiProfileOverrides {
  refinement?: Partial<z.input<typeof refinementAiProfileSchema>>;
  summary?: Partial<z.input<typeof summaryAiProfileSchema>>;
  transcription?: Partial<z.input<typeof transcriptionAiProfileSchema>>;
}

export function createInitialAiProfile(
  guildId: string,
  overrides: InitialAiProfileOverrides = {},
): AiProfile {
  return aiProfileSchema.parse({
    guildId,
    name: "Profile 1",
    profileId: `${guildId}-profile-1`,
    refinement: overrides.refinement ?? {},
    summary: overrides.summary ?? {},
    transcription: overrides.transcription ?? {},
  });
}

export function isAiProfileComplete(profile: AiProfile): boolean {
  return [profile.transcription, profile.refinement, profile.summary].every(
    (phase) => phase.provider !== null && phase.model !== null,
  );
}

export function resolveAiProfile(profile: AiProfile) {
  if (!isAiProfileComplete(profile)) {
    throw new Error("The active AI profile is incomplete");
  }
  const transcription = requireCompletePhase(profile.transcription);
  const refinement = requireCompletePhase(profile.refinement);
  const summary = requireCompletePhase(profile.summary);
  const legacyPromptDefaults = createDefaultAiPrompts("en", summary.language);
  return {
    refinement: {
      generation: refinement.generation,
      maxChunkCharacters: refinement.maxChunkCharacters,
      model: refinement.model,
      prompt: refinement.prompt === undefined ? legacyPromptDefaults.refinement : refinement.prompt,
      provider: refinement.provider,
      requestedModel: refinement.model,
      status: "selected" as const,
    },
    selectorVersion: 3 as const,
    summary: {
      consolidationPrompt:
        summary.consolidationPrompt === undefined
          ? legacyPromptDefaults.summaryConsolidation
          : summary.consolidationPrompt,
      extractionPrompt:
        summary.extractionPrompt === undefined
          ? legacyPromptDefaults.summaryExtraction
          : summary.extractionPrompt,
      generation: summary.generation,
      language: summary.language,
      maxChunkCharacters: summary.maxChunkCharacters,
      model: summary.model,
      provider: summary.provider,
      requestedModel: summary.model,
      status: "selected" as const,
    },
    transcription: {
      batchSize: transcription.batchSize,
      interSpeechSilenceMs: transcription.interSpeechSilenceMs,
      language: transcription.language,
      mergeMaxGapMs: transcription.mergeMaxGapMs,
      model: transcription.model,
      prompt: transcription.prompt ?? null,
      provider: transcription.provider,
      ...(transcription.providerOptions === undefined
        ? {}
        : { providerOptions: transcription.providerOptions }),
      requestedModel: transcription.model,
      status: "selected" as const,
      ...(transcription.temperature === undefined
        ? {}
        : { temperature: transcription.temperature }),
      timestampMode: transcription.timestampMode,
    },
  };
}

function requireCompletePhase<T extends { model: string | null; provider: string | null }>(
  phase: T,
): T & { model: string; provider: NonNullable<T["provider"]> } {
  if (phase.model === null || phase.provider === null) {
    throw new Error("The active AI profile is incomplete");
  }
  return { ...phase, model: phase.model, provider: phase.provider };
}

interface AssessModelCompatibilityInput {
  device?: "cpu" | "gpu";
  hardware: LocalHardwareProfile;
  model: string;
  phase: "refinement" | "summary" | "transcription";
  provider: "faster-whisper" | "ollama" | "openrouter";
}

interface CatalogEntry {
  gpuMemoryBytes?: number;
  memoryBytes: number;
  minimumCpuCores: number;
  model: string;
  phase: AssessModelCompatibilityInput["phase"];
  provider: AssessModelCompatibilityInput["provider"];
  recommendedGpuMemoryBytes?: readonly [minimum: number, maximum: number];
  supportedGpuVendors?: readonly string[];
}

const gibibyte = 1_024 ** 3;
const catalog: readonly CatalogEntry[] = [
  whisper("tiny", 2, 1, 1),
  whisper("base", 3, 2, 1.5),
  whisper("small", 5, 4, 2.5),
  whisper("medium", 10, 8, 3.5, [3.5, 6]),
  whisper("large-v3", 18, 12, 6, [6, Number.POSITIVE_INFINITY]),
  ollama("qwen3:1.7b", "refinement", 4, 2, 2),
  ollama("qwen3:4b-instruct-2507-q4_K_M", "refinement", 7, 4, 4),
  ollama("qwen3:4b-instruct-2507-q4_K_M", "summary", 7, 4, 4, [3.5, 7]),
  ollama("qwen3:8b", "refinement", 11, 8, 7),
  ollama("qwen3:8b", "summary", 11, 8, 7, [7, 11]),
  ollama("qwen3:14b", "summary", 20, 12, 11, [11, Number.POSITIVE_INFINITY]),
];

export function assessModelCompatibility(
  input: AssessModelCompatibilityInput,
): AiProfileCompatibilityStatus {
  if (input.provider === "openrouter") return "unknown";
  const entry = catalog.find(
    (candidate) =>
      candidate.model === input.model &&
      candidate.phase === input.phase &&
      candidate.provider === input.provider,
  );
  if (entry === undefined) return "unknown";
  const device = input.device ?? (input.hardware.gpuMemoryBytes === undefined ? "cpu" : "gpu");
  if (device === "gpu") {
    const accelerators = input.hardware.accelerators ?? [];
    if (
      entry.supportedGpuVendors !== undefined &&
      !accelerators.some((gpu) => entry.supportedGpuVendors?.includes(gpu.vendor))
    ) {
      return "incompatible";
    }
    const available = input.hardware.gpuMemoryBytes ?? 0;
    if (available < (entry.gpuMemoryBytes ?? entry.memoryBytes)) return "above_recommended";
    const range = entry.recommendedGpuMemoryBytes;
    return range !== undefined && available >= range[0] && available < range[1]
      ? "recommended"
      : "compatible";
  }
  if (
    input.hardware.memoryBytes * 0.75 < entry.memoryBytes ||
    input.hardware.cpuCores < entry.minimumCpuCores
  ) {
    return "above_recommended";
  }
  return "compatible";
}

function whisper(
  model: string,
  memoryGiB: number,
  minimumCpuCores: number,
  gpuMemoryGiB: number,
  recommendedGpuGiB?: readonly [number, number],
): CatalogEntry {
  return {
    gpuMemoryBytes: gpuMemoryGiB * gibibyte,
    memoryBytes: memoryGiB * gibibyte,
    minimumCpuCores,
    model,
    phase: "transcription",
    provider: "faster-whisper",
    ...(recommendedGpuGiB === undefined
      ? {}
      : {
          recommendedGpuMemoryBytes: [
            recommendedGpuGiB[0] * gibibyte,
            recommendedGpuGiB[1] * gibibyte,
          ] as const,
        }),
    supportedGpuVendors: ["nvidia"],
  };
}

function ollama(
  model: string,
  phase: "refinement" | "summary",
  memoryGiB: number,
  minimumCpuCores: number,
  gpuMemoryGiB: number,
  recommendedGpuGiB?: readonly [number, number],
): CatalogEntry {
  return {
    gpuMemoryBytes: gpuMemoryGiB * gibibyte,
    memoryBytes: memoryGiB * gibibyte,
    minimumCpuCores,
    model,
    phase,
    provider: "ollama",
    ...(recommendedGpuGiB === undefined
      ? {}
      : {
          recommendedGpuMemoryBytes: [
            recommendedGpuGiB[0] * gibibyte,
            recommendedGpuGiB[1] * gibibyte,
          ] as const,
        }),
    supportedGpuVendors: ["amd", "nvidia"],
  };
}
