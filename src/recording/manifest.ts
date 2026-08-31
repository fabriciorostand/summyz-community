import { isAbsolute, normalize } from "node:path";

import { z } from "zod";

import { externalVadSchema, localVadSchema } from "../ai-profile.js";

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

const selectedModelSchema = z.object({ model: z.string().min(1) });

const generationSchema = z
  .object({
    seed: z.number().int().optional(),
    temperature: z.number().min(0).max(2).optional(),
    think: z.boolean().optional(),
  })
  .default({});

const resolvedPromptSchema = z.string().min(1).max(20_000).nullable();

const currentRefinementBase = selectedModelSchema.and(
  z.object({
    generation: generationSchema,
    maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
    prompt: resolvedPromptSchema.default(null),
  }),
);
const currentSummaryBase = selectedModelSchema.and(
  z.object({
    generation: generationSchema,
    language: z.string().min(1),
    maxChunkCharacters: z.number().int().min(1_000).max(10_000_000).default(500_000),
    consolidationPrompt: resolvedPromptSchema.default(null),
    extractionPrompt: resolvedPromptSchema.default(null),
  }),
);
const currentTranscriptionBase = selectedModelSchema.and(
  z.object({
    interSpeechSilenceMs: z.number().int().min(0).max(5_000).default(0),
    language: z.string().min(1),
    mergeMaxGapMs: z.number().int().min(0).max(30_000).optional(),
    prompt: resolvedPromptSchema.default(null),
    providerOptions: z.record(z.string().min(1), z.record(z.string().min(1), z.json())).optional(),
    temperature: z.number().min(0).max(1).optional(),
  }),
);

export const meetingAiConfigurationSchema = z.discriminatedUnion("profileType", [
  z.object({
    profileType: z.literal("external"),
    refinement: currentRefinementBase.and(z.object({ provider: z.literal("openrouter") })),
    summary: currentSummaryBase.and(z.object({ provider: z.literal("openrouter") })),
    transcription: currentTranscriptionBase.and(
      z.object({ provider: z.literal("openrouter"), vad: externalVadSchema }),
    ),
  }),
  z.object({
    profileType: z.literal("local"),
    refinement: currentRefinementBase.and(z.object({ provider: z.literal("ollama") })),
    summary: currentSummaryBase.and(z.object({ provider: z.literal("ollama") })),
    transcription: currentTranscriptionBase.and(
      z.object({
        batchSize: z.union([z.literal("auto"), z.number().int().min(0).max(64)]).default("auto"),
        provider: z.literal("faster-whisper"),
        vad: localVadSchema,
      }),
    ),
  }),
]);

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

const recordingManifestBaseShape = {
  botLanguage: z.enum(["en", "pt-BR"]).optional(),
  completedAt: z.iso.datetime().optional(),
  guildId: z.string().min(1),
  interruptions: z.array(interruptionSchema),
  meetingId: storageIdentifierSchema,
  notificationChannelId: z.string().min(1),
  persistMeetingAudio: z.boolean().default(false),
  persistMeetingContent: z.boolean().default(false),
  segments: z.array(segmentSchema),
  startedAt: z.iso.datetime(),
  status: manifestStatusSchema,
  storageMode: z.literal("postgres"),
  voiceChannelId: z.string().min(1),
  voiceChannelName: z.string().min(1).max(100).optional(),
};

export const recordingManifestSchema = z.object({
  ...recordingManifestBaseShape,
  aiConfiguration: meetingAiConfigurationSchema.optional(),
  participants: z.array(
    z.object({
      displayName: z.string().min(1).max(100),
      userId: storageIdentifierSchema,
    }),
  ),
  schemaVersion: z.literal(3),
});

export type RecordingManifest = z.infer<typeof recordingManifestSchema>;
export type MeetingAiConfiguration = z.input<typeof meetingAiConfigurationSchema>;
export type ResolvedMeetingAiConfiguration = z.infer<typeof meetingAiConfigurationSchema>;
export type RecordingSegment = z.infer<typeof segmentSchema>;
export type RecordingSegmentInput = z.input<typeof segmentSchema>;

export function requireCurrentMeetingAiConfiguration(
  manifest: RecordingManifest,
): ResolvedMeetingAiConfiguration {
  if (manifest.aiConfiguration === undefined) {
    throw new Error("The meeting does not have a pinned AI profile");
  }
  return meetingAiConfigurationSchema.parse(manifest.aiConfiguration);
}

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
    participants: [],
    schemaVersion: 3,
    segments: [],
    status: "recording",
    storageMode: "postgres",
  });
}

export function addParticipant(
  manifest: RecordingManifest,
  participant: RecordingManifest["participants"][number],
): RecordingManifest {
  const participants = manifest.participants.some((item) => item.userId === participant.userId)
    ? manifest.participants.map((item) => (item.userId === participant.userId ? participant : item))
    : [...manifest.participants, participant];
  return recordingManifestSchema.parse({ ...manifest, participants });
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
