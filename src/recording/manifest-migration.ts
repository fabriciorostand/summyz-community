import { z } from "zod";

import { type RecordingManifest, recordingManifestSchema } from "./manifest.js";

const legacyManifestSchema = z
  .object({
    aiConfiguration: z.unknown().optional(),
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    segments: z.array(
      z.object({ userDisplayName: z.string().min(1), userId: z.string().min(1) }).passthrough(),
    ),
  })
  .passthrough();

export function migrateRecordingManifest(value: unknown): RecordingManifest {
  const current = recordingManifestSchema.safeParse(value);
  if (current.success) return current.data;

  const legacy = legacyManifestSchema.parse(value);
  const participants = [
    ...new Map(
      legacy.segments.map((segment) => [
        segment.userId,
        { displayName: segment.userDisplayName, userId: segment.userId },
      ]),
    ).values(),
  ];
  return recordingManifestSchema.parse({
    ...legacy,
    aiConfiguration: migrateAiConfiguration(legacy.aiConfiguration),
    participants,
    schemaVersion: 3,
    storageMode: "postgres",
  });
}

function migrateAiConfiguration(value: unknown): unknown {
  if (value === undefined) return undefined;
  const configuration = z
    .object({
      profileType: z.enum(["external", "local"]).optional(),
      transcription: z.record(z.string(), z.unknown()),
    })
    .passthrough()
    .parse(value);
  const profileType = configuration.profileType ?? inferProfileType(configuration.transcription);
  const { timestampMode: _timestampMode, ...withoutTimestampMode } = configuration.transcription;
  const transcription =
    profileType === "external"
      ? omitProperty(withoutTimestampMode, "batchSize")
      : withoutTimestampMode;
  return { ...configuration, profileType, transcription };
}

function inferProfileType(transcription: Record<string, unknown>): "external" | "local" {
  const provider = z.enum(["openrouter", "faster-whisper"]).parse(transcription.provider);
  return provider === "openrouter" ? "external" : "local";
}

function omitProperty(value: Record<string, unknown>, property: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== property));
}
