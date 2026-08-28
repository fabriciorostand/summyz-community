import { isAbsolute, normalize } from "node:path";

import { z } from "zod";

const storageIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);

export const manifestStatusSchema = z.enum(["recording", "interrupted", "completed"]);
export type ManifestStatus = z.infer<typeof manifestStatusSchema>;

const interruptionSchema = z.object({
  at: z.iso.datetime(),
  reason: z.string().min(1),
  resumedAt: z.iso.datetime().optional(),
});

const selectedModelSchema = z.object({
  hardwareWarning: z.literal(true).optional(),
  model: z.string().min(1),
  requestedModel: z.string().min(1),
  status: z.literal("selected"),
});

const generationSchema = z
  .object({
    seed: z.number().int().optional(),
    temperature: z.number().min(0).max(2).optional(),
    think: z.boolean().optional(),
  })
  .default({});

const resolvedPromptSchema = z.string().min(1).max(20_000).nullable();

export const meetingAiConfigurationSchema = z.object({
  refinement: selectedModelSchema.and(
    z.object({
      generation: generationSchema,
      maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
      prompt: resolvedPromptSchema.default(null),
      provider: z.enum(["openrouter", "ollama"]),
    }),
  ),
  selectorVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  summary: selectedModelSchema.and(
    z.object({
      generation: generationSchema,
      language: z.string().min(1),
      maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
      consolidationPrompt: resolvedPromptSchema.default(null),
      extractionPrompt: resolvedPromptSchema.default(null),
      provider: z.enum(["openrouter", "ollama"]),
    }),
  ),
  transcription: selectedModelSchema.and(
    z.object({
      batchSize: z.union([z.literal("auto"), z.number().int().min(0).max(64)]).default("auto"),
      interSpeechSilenceMs: z.number().int().min(0).max(5_000).default(0),
      language: z.string().min(1),
      mergeMaxGapMs: z.number().int().min(0).max(30_000).optional(),
      prompt: resolvedPromptSchema.default(null),
      provider: z.enum(["openrouter", "faster-whisper"]),
      providerOptions: z
        .record(z.string().min(1), z.record(z.string().min(1), z.json()))
        .optional(),
      temperature: z.number().min(0).max(1).optional(),
      timestampMode: z.enum(["batch", "word"]).default("word"),
    }),
  ),
});

export const segmentSchema = z.object({
  durationMs: z.number().nonnegative(),
  endedAtMs: z.number().nonnegative(),
  estimatedPacketLossPercent: z.number().min(0).max(100).optional(),
  file: z
    .string()
    .min(1)
    .refine(isRelativeSafePath, "O caminho do segmento deve permanecer dentro da reunião"),
  format: z.enum(["ogg_opus", "pcm_s16le"]).default("ogg_opus"),
  receivedOpusPackets: z.number().int().nonnegative().optional(),
  segmentId: storageIdentifierSchema,
  startedAtMs: z.number().nonnegative(),
  status: z.enum(["ready", "conversion_failed"]).default("ready"),
  userDisplayName: z.string().min(1),
  userId: storageIdentifierSchema,
});

export const recordingManifestSchema = z.object({
  aiConfiguration: meetingAiConfigurationSchema.optional(),
  botLanguage: z.enum(["en", "pt-BR"]).optional(),
  completedAt: z.iso.datetime().optional(),
  guildId: z.string().min(1),
  interruptions: z.array(interruptionSchema),
  meetingId: storageIdentifierSchema,
  notificationChannelId: z.string().min(1),
  persistMeetingAudio: z.boolean().default(false),
  persistMeetingContent: z.boolean().default(false),
  schemaVersion: z.literal(1),
  segments: z.array(segmentSchema),
  startedAt: z.iso.datetime(),
  status: manifestStatusSchema,
  storageMode: z.enum(["local", "postgres"]).default("local"),
  voiceChannelId: z.string().min(1),
  voiceChannelName: z.string().min(1).max(100).optional(),
});

export type RecordingManifest = z.infer<typeof recordingManifestSchema>;
export type MeetingAiConfiguration = z.input<typeof meetingAiConfigurationSchema>;
export type ResolvedMeetingAiConfiguration = z.infer<typeof meetingAiConfigurationSchema>;
export type RecordingSegment = z.infer<typeof segmentSchema>;
export type RecordingSegmentInput = z.input<typeof segmentSchema>;

export type CreateManifestInput = Pick<
  RecordingManifest,
  | "guildId"
  | "meetingId"
  | "notificationChannelId"
  | "startedAt"
  | "voiceChannelId"
  | "voiceChannelName"
> &
  Partial<
    Pick<
      RecordingManifest,
      "botLanguage" | "persistMeetingAudio" | "persistMeetingContent" | "storageMode"
    >
  > & {
    aiConfiguration?: MeetingAiConfiguration;
  };

export function createManifest(input: CreateManifestInput): RecordingManifest {
  return recordingManifestSchema.parse({
    ...input,
    interruptions: [],
    schemaVersion: 1,
    segments: [],
    status: "recording",
    storageMode: input.storageMode ?? "postgres",
  });
}

export function addSegment(
  manifest: RecordingManifest,
  segment: RecordingSegmentInput,
): RecordingManifest {
  assertRelativeSafePath(segment.file);
  return recordingManifestSchema.parse({
    ...manifest,
    segments: [...manifest.segments, segmentSchema.parse(segment)],
  });
}

export function markManifestInterrupted(
  manifest: RecordingManifest,
  at: string,
  reason: string,
): RecordingManifest {
  return recordingManifestSchema.parse({
    ...manifest,
    interruptions: [...manifest.interruptions, { at, reason }],
    status: "interrupted",
  });
}

export function markManifestRecording(
  manifest: RecordingManifest,
  resumedAt: string,
): RecordingManifest {
  const interruptions = manifest.interruptions.map((interruption, index) =>
    index === manifest.interruptions.length - 1 ? { ...interruption, resumedAt } : interruption,
  );

  return recordingManifestSchema.parse({
    ...manifest,
    interruptions,
    status: "recording",
  });
}

export function markManifestCompleted(
  manifest: RecordingManifest,
  completedAt: string,
): RecordingManifest {
  return recordingManifestSchema.parse({
    ...manifest,
    completedAt,
    status: "completed",
  });
}

function assertRelativeSafePath(filePath: string): void {
  if (!isRelativeSafePath(filePath)) {
    throw new Error("O caminho do segmento deve permanecer dentro da reunião");
  }
}

function isRelativeSafePath(filePath: string): boolean {
  const normalized = normalize(filePath).replaceAll("\\", "/");
  return !isAbsolute(filePath) && normalized !== ".." && !normalized.startsWith("../");
}
