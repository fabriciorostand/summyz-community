import { z } from "zod";

/* AI profiles, their per-stage selections and the local model catalog, downloads and availability. */
const generationSchema = z.object({
  seed: z.number().int().optional(),
  temperature: z.number().optional(),
  think: z.boolean().optional(),
});
const promptSchema = z.string().nullable();
export const promptDefaultsSchema = z.object({
  refinement: z.string(),
  summaryConsolidation: z.string(),
  summaryExtraction: z.string(),
  transcription: z.null(),
});
const automaticNumberSchema = z.union([z.literal("auto"), z.number()]);
const externalVadSchema = z.object({
  enabled: z.boolean(),
  minSilenceDurationMs: z.number().int(),
  minSpeechDurationMs: z.number().int(),
  negativeSpeechThreshold: automaticNumberSchema,
  speechPadMs: z.number().int(),
  threshold: z.number(),
});
const localVadSchema = z.object({
  enabled: z.boolean(),
  maxSpeechDurationSeconds: automaticNumberSchema,
  minSilenceDurationMs: automaticNumberSchema,
  minSpeechDurationMs: z.number().int(),
  negativeSpeechThreshold: automaticNumberSchema,
  speechPadMs: z.number().int(),
  threshold: z.number(),
});
const profileLanguages = [
  ...(["auto", "ar", "cs", "da", "de", "el", "en", "en-GB", "en-US", "es"] as const),
  ...(["es-ES", "es-MX", "fi", "fr", "fr-CA", "he", "hi", "hu", "id", "it"] as const),
  ...(["ja", "ko", "nl", "no", "pl", "pt", "pt-BR", "pt-PT", "ro", "ru"] as const),
  ...(["sv", "th", "tr", "uk", "vi", "zh", "zh-CN", "zh-TW"] as const),
] as const;
const promptModeSchema = z.enum(["default", "custom"]);
/**
 * "default" makes the server store and use its English default for the effective summary
 * language; "custom" keeps the text exactly as sent.
 */
export const promptModesSchema = z.object({
  refinement: promptModeSchema,
  summaryConsolidation: promptModeSchema,
  summaryExtraction: promptModeSchema,
  transcription: promptModeSchema,
});
const profileBaseShape = {
  language: z.enum(profileLanguages),
  promptModes: promptModesSchema,
  name: z.string(),
  profileId: z.string(),
};
const refinementBaseShape = {
  generation: generationSchema,
  maxChunkCharacters: z.number().int(),
  model: z.string().nullable(),
  prompt: promptSchema,
};
const summaryBaseShape = {
  consolidationPrompt: promptSchema,
  extractionPrompt: promptSchema,
  generation: generationSchema,
  maxChunkCharacters: z.number().int(),
  model: z.string().nullable(),
};
const transcriptionBaseShape = {
  interSpeechSilenceMs: z.number().int(),
  language: z.enum(profileLanguages),
  mergeMaxGapMs: z.number().int(),
  model: z.string().nullable(),
  prompt: promptSchema,
  providerOptions: z.record(z.string(), z.record(z.string(), z.json())).optional(),
  temperature: z.number().optional(),
};
/* Each stage picks its own provider; the setup profile starts with none chosen. */
const transcriptionStageSchema = z.discriminatedUnion("provider", [
  z.object({
    ...transcriptionBaseShape,
    provider: z.literal("openrouter"),
    vad: externalVadSchema,
  }),
  z.object({
    ...transcriptionBaseShape,
    batchSize: z.union([z.literal("auto"), z.number().int()]),
    provider: z.literal("faster-whisper"),
    vad: localVadSchema,
  }),
  z.object({ ...transcriptionBaseShape, provider: z.null(), vad: externalVadSchema }),
]);
const refinementStageSchema = z.discriminatedUnion("provider", [
  z.object({ ...refinementBaseShape, provider: z.literal("openrouter") }),
  z.object({ ...refinementBaseShape, provider: z.literal("ollama") }),
  z.object({ ...refinementBaseShape, provider: z.null() }),
]);
const summaryStageSchema = z.discriminatedUnion("provider", [
  z.object({ ...summaryBaseShape, provider: z.literal("openrouter") }),
  z.object({ ...summaryBaseShape, provider: z.literal("ollama") }),
  z.object({ ...summaryBaseShape, provider: z.null() }),
]);
/** Calculated by the server from the stage providers; it is never sent back. */
export const profileTypeSchema = z.enum(["external", "local", "hybrid"]).nullable();
export const profileSchema = z.object({
  ...profileBaseShape,
  profileType: profileTypeSchema,
  refinement: refinementStageSchema,
  summary: summaryStageSchema,
  transcription: transcriptionStageSchema,
});
const localProviderSchema = z.enum(["ollama", "faster-whisper"]);
const modelPhaseSchema = z.enum(["transcription", "refinement", "summary"]);
export const profileAvailabilitySchema = z.object({
  missingModels: z.array(
    z.object({ model: z.string(), phase: modelPhaseSchema, provider: localProviderSchema }),
  ),
  status: z.enum(["ready", "incomplete", "missing_models", "unavailable"]),
  unavailableProviders: z.array(localProviderSchema),
});
export const profileListItemSchema = z.object({
  active: z.boolean(),
  activeServerCount: z.number().int().nonnegative(),
  availability: profileAvailabilitySchema,
  profile: profileSchema,
});
export const modelCatalogSchema = z.object({
  fetchedAt: z.number().nonnegative(),
  installedModels: z.array(z.object({ model: z.string(), sizeBytes: z.number().nullable() })),
  inventoryStatus: z.enum(["available", "unavailable", "not_applicable"]),
  items: z.array(
    z.object({
      compatibility: z.enum([
        "recommended",
        "compatible",
        "above_recommended",
        "unknown",
        "incompatible",
      ]),
      family: z.string().optional(),
      installed: z.boolean().nullable(),
      model: z.string(),
      name: z.string(),
      sizeBytes: z.number().nullable(),
      variantsAvailable: z.boolean().optional(),
    }),
  ),
  phase: modelPhaseSchema,
  provider: z.enum(["openrouter", "ollama", "faster-whisper"]),
  status: z.enum(["fresh", "stale", "unavailable"]),
});
export const modelDownloadSchema = z.object({
  completedBytes: z.number().nonnegative(),
  downloadId: z.string(),
  failureCode: z.string().nullable(),
  model: z.string(),
  provider: localProviderSchema,
  status: z.enum(["queued", "downloading", "completed", "cancelling", "cancelled", "failed"]),
  totalBytes: z.number().nonnegative().nullable(),
});

export type Profile = z.infer<typeof profileSchema>;
export type ProfileType = z.infer<typeof profileTypeSchema>;
export type ProfileInput = Omit<Profile, "profileId" | "profileType">;
export type ProfileAvailability = z.infer<typeof profileAvailabilitySchema>;
export type ProfileListItem = z.infer<typeof profileListItemSchema>;
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export type ModelCatalogItem = ModelCatalog["items"][number];
export type ModelDownload = z.infer<typeof modelDownloadSchema>;
export type PromptDefaults = z.infer<typeof promptDefaultsSchema>;
