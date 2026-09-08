import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

import type { AudioReceiveStream } from "@discordjs/voice";
import type { Logger } from "pino";
import { opus } from "prism-media";

import type { AppConfig } from "../config.js";
import { convertPcmToOgg } from "./audio-converter.js";
import type { RecordingSegment } from "./manifest.js";
import type { ManifestStore } from "./manifest-store.js";
import { estimatePacketLossPercent } from "./recording-metrics.js";
import { getErrorType } from "./recording-utils.js";

export type CaptureEndReason = "error" | "max_duration" | "silence" | "stopped";

interface DiscordAudioCaptureInput {
  config: AppConfig;
  displayName: string;
  getForcedReason(): CaptureEndReason | undefined;
  guildId: string;
  logger: Logger;
  manifestStartedAt: string;
  meetingId: string;
  onReceiveError(): void;
  onSegment(segment: RecordingSegment): Promise<void>;
  opusStream: AudioReceiveStream;
  paths: ReturnType<ManifestStore["segmentPaths"]>;
  prepareDirectory(): Promise<void>;
  segmentId: string;
  startedAtMs: number;
  userId: string;
}

export async function captureDiscordAudioSegment(
  input: DiscordAudioCaptureInput,
): Promise<CaptureEndReason> {
  const capture = await capturePcmAudio(input);
  const emptyCaptureReason = await removeEmptyCapture(input, capture.streamFailed);
  if (emptyCaptureReason !== undefined) return emptyCaptureReason;

  const measurements = measureCapturedSegment(
    input,
    capture.receivedOpusPackets,
    capture.streamFailed,
  );
  const segment = await convertCapturedSegment(input, measurements);
  await finalizeCapturedSegment(input, segment);
  return finalCaptureReason(input, capture.streamFailed);
}

interface PcmCaptureResult {
  readonly receivedOpusPackets: number;
  readonly streamFailed: boolean;
}

async function capturePcmAudio(input: DiscordAudioCaptureInput): Promise<PcmCaptureResult> {
  await input.prepareDirectory();
  const decoder = new opus.Decoder({ channels: 2, frameSize: 960, rate: 48_000 });
  const output = createWriteStream(input.paths.temporaryPath, { flags: "wx" });
  let receivedOpusPackets = 0;
  let streamFailed = false;
  input.opusStream.on("data", () => {
    receivedOpusPackets += 1;
  });

  try {
    await pipeline(input.opusStream, decoder, output);
  } catch (error) {
    if (input.getForcedReason() === undefined) {
      streamFailed = true;
      input.logger.error(
        {
          errorType: getErrorType(error),
          guildId: input.guildId,
          meetingId: input.meetingId,
          userId: input.userId,
        },
        "Audio segment capture failed",
      );
    }
  }
  return { receivedOpusPackets, streamFailed };
}

async function removeEmptyCapture(
  input: DiscordAudioCaptureInput,
  streamFailed: boolean,
): Promise<CaptureEndReason | undefined> {
  const fileSize = await stat(input.paths.temporaryPath)
    .then((file) => file.size)
    .catch(() => 0);
  if (fileSize > 0) return undefined;

  await rm(input.paths.temporaryPath, { force: true });
  if (streamFailed) {
    input.onReceiveError();
    return "error";
  }
  return input.getForcedReason() ?? "silence";
}

interface SegmentMeasurements {
  readonly durationMs: number;
  readonly endedAtMs: number;
  readonly estimatedPacketLossPercent: number;
  readonly receivedOpusPackets: number;
}

function measureCapturedSegment(
  input: DiscordAudioCaptureInput,
  receivedOpusPackets: number,
  streamFailed: boolean,
): SegmentMeasurements {
  const endedAtMs = Math.max(input.startedAtMs, Date.now() - Date.parse(input.manifestStartedAt));
  const durationMs = endedAtMs - input.startedAtMs;
  const captureEndReason = input.getForcedReason() ?? (streamFailed ? "error" : "silence");
  const estimatedPacketLossPercent = estimatePacketLossPercent({
    durationMs,
    receivedPackets: receivedOpusPackets,
    trailingSilenceMs: captureEndReason === "silence" ? input.config.segmentSilenceMs : 0,
  });
  return { durationMs, endedAtMs, estimatedPacketLossPercent, receivedOpusPackets };
}

async function convertCapturedSegment(
  input: DiscordAudioCaptureInput,
  measurements: SegmentMeasurements,
): Promise<RecordingSegment> {
  try {
    await convertPcmToOgg(input.paths.temporaryPath, input.paths.finalPath);
    await rm(input.paths.temporaryPath, { force: true });
    return {
      durationMs: measurements.durationMs,
      endedAtMs: measurements.endedAtMs,
      estimatedPacketLossPercent: measurements.estimatedPacketLossPercent,
      file: input.paths.relativeFinalPath,
      format: "ogg_opus",
      receivedOpusPackets: measurements.receivedOpusPackets,
      segmentId: input.segmentId,
      startedAtMs: input.startedAtMs,
      status: "ready",
      userDisplayName: input.displayName,
      userId: input.userId,
    };
  } catch (error) {
    input.logger.error(
      {
        errorType: getErrorType(error),
        guildId: input.guildId,
        meetingId: input.meetingId,
        segmentId: input.segmentId,
      },
      "Audio segment conversion to Ogg/Opus failed",
    );
    return {
      durationMs: measurements.durationMs,
      endedAtMs: measurements.endedAtMs,
      estimatedPacketLossPercent: measurements.estimatedPacketLossPercent,
      file: input.paths.relativeTemporaryPath,
      format: "pcm_s16le",
      receivedOpusPackets: measurements.receivedOpusPackets,
      segmentId: input.segmentId,
      startedAtMs: input.startedAtMs,
      status: "conversion_failed",
      userDisplayName: input.displayName,
      userId: input.userId,
    };
  }
}

async function finalizeCapturedSegment(
  input: DiscordAudioCaptureInput,
  segment: RecordingSegment,
): Promise<void> {
  await input.onSegment(segment);
  input.logger.info(
    {
      durationMs: segment.durationMs,
      estimatedPacketLossPercent: segment.estimatedPacketLossPercent,
      guildId: input.guildId,
      meetingId: input.meetingId,
      receivedOpusPackets: segment.receivedOpusPackets,
      segmentId: segment.segmentId,
      userId: input.userId,
    },
    "Audio segment finalized",
  );
}

function finalCaptureReason(
  input: DiscordAudioCaptureInput,
  streamFailed: boolean,
): CaptureEndReason {
  if (streamFailed) {
    input.onReceiveError();
    return "error";
  }
  return input.getForcedReason() ?? "silence";
}
