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

export const meetingAiConfigurationSchema = z.object({
  refinement: selectedModelSchema.and(z.object({ provider: z.enum(["openrouter", "ollama"]) })),
  selectorVersion: z.literal(1),
  summary: selectedModelSchema.and(
    z.object({
      language: z.string().min(1),
      provider: z.enum(["openrouter", "ollama"]),
    }),
  ),
  transcription: selectedModelSchema.and(
    z.object({
      language: z.string().min(1),
      provider: z.enum(["openrouter", "faster-whisper"]),
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
export type MeetingAiConfiguration = z.infer<typeof meetingAiConfigurationSchema>;
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
      "aiConfiguration" | "persistMeetingAudio" | "persistMeetingContent" | "storageMode"
    >
  >;

export function createManifest(input: CreateManifestInput): RecordingManifest {
  return recordingManifestSchema.parse({
    ...input,
    interruptions: [],
    schemaVersion: 1,
    segments: [],
    status: "recording",
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
