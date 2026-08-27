import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join, resolve } from "node:path";

import { z } from "zod";

import { calculateTranscriptMetrics } from "../src/local-ai/transcription-benchmark.js";
import { recordingManifestSchema } from "../src/recording/manifest.js";
import { FasterWhisperTranscriptionProvider } from "../src/transcription/faster-whisper-transcription-provider.js";

const benchmarkEnvironmentSchema = z.object({
  BENCHMARK_BATCH_SIZE: z.coerce.number().int().min(0).max(64).default(0),
  BENCHMARK_DATA_DIR: z.string().min(1).default("./data/recordings"),
  BENCHMARK_DEVICE: z.enum(["cpu", "gpu"]).default("cpu"),
  BENCHMARK_FALLBACK: z.enum(["none", "cpu"]).default("none"),
  BENCHMARK_LANGUAGE: z.string().min(2).default("auto"),
  BENCHMARK_MODEL: z.string().min(1).default("small"),
  FASTER_WHISPER_BENCHMARK_URL: z.url().default("http://faster-whisper:8000"),
});

const settings = benchmarkEnvironmentSchema.parse(process.env);
const recordingsDirectory = resolve(settings.BENCHMARK_DATA_DIR);
const meetingDirectories = await readdir(recordingsDirectory, { withFileTypes: true });
const results: Array<Record<string, unknown>> = [];

for (const entry of meetingDirectories.filter((candidate) => candidate.isDirectory())) {
  const directory = join(recordingsDirectory, entry.name);
  const result = await benchmarkMeeting(directory).catch((error: unknown) => ({
    meeting: anonymousMeetingId(entry.name),
    reason: error instanceof Error ? error.name : typeof error,
    status: "failed",
  }));
  results.push(result);
}

const completed = results.filter((result) => result.status === "completed");
const totalAudioMilliseconds = completed.reduce(
  (total, result) => total + Number(result.audioMilliseconds ?? 0),
  0,
);
const totalElapsedMilliseconds = completed.reduce(
  (total, result) => total + Number(result.elapsedMilliseconds ?? 0),
  0,
);
console.info(
  JSON.stringify(
    {
      aggregate: {
        audioMilliseconds: totalAudioMilliseconds,
        elapsedMilliseconds: totalElapsedMilliseconds,
        realTimeFactor:
          totalAudioMilliseconds === 0 ? null : totalElapsedMilliseconds / totalAudioMilliseconds,
      },
      environment: {
        batchSize: settings.BENCHMARK_BATCH_SIZE,
        containerCpuCount: cpus().length,
        device: settings.BENCHMARK_DEVICE,
        fallback: settings.BENCHMARK_FALLBACK,
        model: settings.BENCHMARK_MODEL,
      },
      meetings: results,
      schemaVersion: 1,
    },
    null,
    2,
  ),
);

async function benchmarkMeeting(directory: string): Promise<Record<string, unknown>> {
  const manifestPath = join(directory, "manifest.json");
  const referencePath = join(directory, "transcript.raw.txt");
  const manifest = recordingManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  const reference = await readFile(referencePath, "utf8");
  const readySegments = manifest.segments
    .filter((segment) => segment.status === "ready")
    .toSorted(
      (left, right) =>
        left.startedAtMs - right.startedAtMs || left.segmentId.localeCompare(right.segmentId),
    );
  if (readySegments.length === 0) {
    return {
      meeting: anonymousMeetingId(manifest.meetingId),
      reason: "no_segments",
      status: "skipped",
    };
  }

  const audio = await Promise.all(
    readySegments.map(async (segment) => ({
      bytes: await readFile(join(directory, segment.file)),
      durationMs: segment.durationMs,
      format: segment.format === "ogg_opus" ? ("ogg" as const) : ("wav" as const),
    })),
  ).catch(() => undefined);
  if (audio === undefined) {
    return {
      meeting: anonymousMeetingId(manifest.meetingId),
      reason: "audio_not_retained",
      status: "skipped",
    };
  }

  const provider = new FasterWhisperTranscriptionProvider({
    baseUrl: settings.FASTER_WHISPER_BENCHMARK_URL,
    batchSize: settings.BENCHMARK_BATCH_SIZE,
    device: settings.BENCHMARK_DEVICE,
    fallback: settings.BENCHMARK_FALLBACK,
    language: settings.BENCHMARK_LANGUAGE,
    model: settings.BENCHMARK_MODEL,
    timeoutMs: 30 * 60 * 1_000,
  });
  const startedAt = performance.now();
  const hypothesisParts: string[] = [];
  for (const segment of audio) {
    const transcription = await provider.transcribe({
      audio: segment.bytes,
      format: segment.format,
    });
    hypothesisParts.push(...transcription.pieces.map((piece) => piece.text));
  }
  const elapsedMilliseconds = Math.round(performance.now() - startedAt);
  const audioMilliseconds = audio.reduce((total, segment) => total + segment.durationMs, 0);
  return {
    audioMilliseconds,
    elapsedMilliseconds,
    meeting: anonymousMeetingId(manifest.meetingId),
    ...calculateTranscriptMetrics(reference, hypothesisParts.join(" ")),
    realTimeFactor: elapsedMilliseconds / audioMilliseconds,
    segmentCount: audio.length,
    status: "completed",
  };
}

function anonymousMeetingId(meetingId: string): string {
  return createHash("sha256").update(meetingId).digest("hex").slice(0, 12);
}
