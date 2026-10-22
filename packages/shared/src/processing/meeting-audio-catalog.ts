import { posix } from "node:path";

import { z } from "zod";

import { type RecordingManifest, recordingManifestSchema } from "../recording/manifest.js";

export const meetingAudioCatalogSchema = z.object({
  meetingId: z.string().min(1).max(128),
  schemaVersion: z.literal(1),
  segments: z.array(
    z.object({
      durationMs: z.number().nonnegative(),
      endedAtMs: z.number().nonnegative(),
      format: z.enum(["ogg_opus", "pcm_s16le"]),
      relativePath: z.string().min(1),
      segmentId: z.string().min(1).max(128),
      startedAtMs: z.number().nonnegative(),
      status: z.enum(["ready", "conversion_failed"]),
      userDisplayName: z.string().min(1),
      userId: z.string().min(1).max(128),
    }),
  ),
});

export type MeetingAudioCatalogData = z.infer<typeof meetingAudioCatalogSchema>;

export interface MeetingAudioCatalog {
  persist(manifest: RecordingManifest): Promise<boolean>;
}

export function createMeetingAudioCatalog(manifest: RecordingManifest): MeetingAudioCatalogData {
  const validated = recordingManifestSchema.parse(manifest);
  return meetingAudioCatalogSchema.parse({
    meetingId: validated.meetingId,
    schemaVersion: 1,
    segments: validated.segments.map((segment) => ({
      durationMs: segment.durationMs,
      endedAtMs: segment.endedAtMs,
      format: segment.format,
      relativePath: posix.join("recordings", validated.meetingId, segment.file),
      segmentId: segment.segmentId,
      startedAtMs: segment.startedAtMs,
      status: segment.status,
      userDisplayName: segment.userDisplayName,
      userId: segment.userId,
    })),
  });
}
