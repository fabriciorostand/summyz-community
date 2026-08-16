import { isAbsolute, normalize } from "node:path";

import { z } from "zod";

export const manifestStatusSchema = z.enum(["recording", "interrupted", "completed"]);
export type ManifestStatus = z.infer<typeof manifestStatusSchema>;

const interruptionSchema = z.object({
  at: z.iso.datetime(),
  reason: z.string().min(1),
  resumedAt: z.iso.datetime().optional(),
});

export const segmentSchema = z.object({
  durationMs: z.number().nonnegative(),
  endedAtMs: z.number().nonnegative(),
  estimatedPacketLossPercent: z.number().min(0).max(100).optional(),
  file: z.string().min(1),
  format: z.enum(["ogg_opus", "pcm_s16le"]).default("ogg_opus"),
  receivedOpusPackets: z.number().int().nonnegative().optional(),
  segmentId: z.string().min(1),
  startedAtMs: z.number().nonnegative(),
  status: z.enum(["ready", "conversion_failed"]).default("ready"),
  userDisplayName: z.string().min(1),
  userId: z.string().min(1),
});

export const recordingManifestSchema = z.object({
  completedAt: z.iso.datetime().optional(),
  guildId: z.string().min(1),
  interruptions: z.array(interruptionSchema),
  meetingId: z.string().min(1),
  notificationChannelId: z.string().min(1),
  schemaVersion: z.literal(1),
  segments: z.array(segmentSchema),
  startedAt: z.iso.datetime(),
  status: manifestStatusSchema,
  voiceChannelId: z.string().min(1),
});

export type RecordingManifest = z.infer<typeof recordingManifestSchema>;
export type RecordingSegment = z.infer<typeof segmentSchema>;
export type RecordingSegmentInput = z.input<typeof segmentSchema>;

export type CreateManifestInput = Pick<
  RecordingManifest,
  "guildId" | "meetingId" | "notificationChannelId" | "startedAt" | "voiceChannelId"
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
  const normalized = normalize(filePath).replaceAll("\\", "/");
  if (isAbsolute(filePath) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("O caminho do segmento deve permanecer dentro da reunião");
  }
}
