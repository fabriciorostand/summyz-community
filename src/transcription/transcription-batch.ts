import type { RecordingSegment } from "../recording/manifest.js";
import type { TranscriptPiece } from "./transcription-provider.js";
import type { SpeechRange } from "./speech-analyzer.js";

export const TRANSCRIPTION_SAMPLE_RATE = 16_000;

export interface AnalyzedSegment {
  containsSpeech: boolean;
  samples: Float32Array;
  segment: RecordingSegment;
  speechRanges: SpeechRange[];
}

export interface TranscriptionBatch {
  audio: Buffer;
  audioDurationMs: number;
  durationMs: number;
  representativeSegmentId: string;
  segmentIds: string[];
  timelineSpans: TimelineSpan[];
  timelineStartedAtMs: number;
}

interface TimelineSpan {
  audioEndedAtMs: number;
  audioStartedAtMs: number;
  timelineEndedAtMs: number;
  timelineStartedAtMs: number;
}

interface TranscriptionGroupOptions {
  maxGapMs: number;
  maxWindowMs: number;
}

export function createTranscriptionGroups(
  segments: readonly RecordingSegment[],
  options: TranscriptionGroupOptions,
): RecordingSegment[][] {
  const groups = [...recordingSegmentsByUser(segments).values()].flatMap((userSegments) =>
    groupRecordingSegments(userSegments, options),
  );
  return groups.sort((left, right) => compareSegments(left[0], right[0]));
}

export function createAnalyzedTranscriptionGroups(
  analyzedSegments: readonly AnalyzedSegment[],
  options: TranscriptionGroupOptions,
  sampleRate = TRANSCRIPTION_SAMPLE_RATE,
): AnalyzedSegment[][] {
  const groups = [...analyzedSegmentsByUser(analyzedSegments).values()].flatMap((userSegments) =>
    groupAnalyzedSegments(userSegments, options, sampleRate),
  );
  return groups.sort((left, right) => compareAnalyzedSegments(left[0], right[0], sampleRate));
}

function recordingSegmentsByUser(
  segments: readonly RecordingSegment[],
): Map<string, RecordingSegment[]> {
  const recordingByUser = new Map<string, RecordingSegment[]>();
  for (const segment of segments) {
    const userSegments = recordingByUser.get(segment.userId) ?? [];
    userSegments.push(segment);
    recordingByUser.set(segment.userId, userSegments);
  }
  return recordingByUser;
}

function analyzedSegmentsByUser(
  analyzedSegments: readonly AnalyzedSegment[],
): Map<string, AnalyzedSegment[]> {
  const byUser = new Map<string, AnalyzedSegment[]>();
  for (const analyzed of analyzedSegments) {
    if (!analyzed.containsSpeech) continue;
    const userSegments = byUser.get(analyzed.segment.userId) ?? [];
    userSegments.push(analyzed);
    byUser.set(analyzed.segment.userId, userSegments);
  }
  return byUser;
}

function groupRecordingSegments(
  userSegments: RecordingSegment[],
  options: TranscriptionGroupOptions,
): RecordingSegment[][] {
  userSegments.sort(compareSegments);
  const groups: RecordingSegment[][] = [];
  let current: RecordingSegment[] = [];
  for (const segment of userSegments) {
    if (!fitsRecordingGroup(current, segment, options)) current = startNextGroup(groups, current);
    current.push(segment);
  }
  startNextGroup(groups, current);
  return groups;
}

function fitsRecordingGroup(
  current: readonly RecordingSegment[],
  segment: RecordingSegment,
  options: TranscriptionGroupOptions,
): boolean {
  const first = current[0];
  const previous = current.at(-1);
  if (first === undefined || previous === undefined) return true;
  return (
    segment.startedAtMs - previous.endedAtMs <= options.maxGapMs &&
    segment.endedAtMs - first.startedAtMs <= options.maxWindowMs
  );
}

function groupAnalyzedSegments(
  userSegments: AnalyzedSegment[],
  options: TranscriptionGroupOptions,
  sampleRate: number,
): AnalyzedSegment[][] {
  const groups: AnalyzedSegment[][] = [];
  userSegments.sort((left, right) => compareAnalyzedSegments(left, right, sampleRate));
  let current: AnalyzedSegment[] = [];
  for (const analyzed of userSegments) {
    if (!fitsAnalyzedGroup(current, analyzed, options, sampleRate)) {
      current = startNextGroup(groups, current);
    }
    current.push(analyzed);
  }
  startNextGroup(groups, current);
  return groups;
}

function fitsAnalyzedGroup(
  current: readonly AnalyzedSegment[],
  analyzed: AnalyzedSegment,
  options: TranscriptionGroupOptions,
  sampleRate: number,
): boolean {
  const first = current[0];
  const previous = current.at(-1);
  if (first === undefined || previous === undefined) return true;
  const currentBounds = speechTimelineBounds(analyzed, sampleRate);
  return (
    currentBounds.startedAtMs - speechTimelineBounds(previous, sampleRate).endedAtMs <=
      options.maxGapMs &&
    currentBounds.endedAtMs - speechTimelineBounds(first, sampleRate).startedAtMs <=
      options.maxWindowMs
  );
}

function startNextGroup<T>(groups: T[][], current: T[]): T[] {
  if (current.length > 0) groups.push(current);
  return [];
}

export function composeTranscriptionBatch(
  analyzedSegments: readonly AnalyzedSegment[],
  sampleRate = TRANSCRIPTION_SAMPLE_RATE,
  interSpeechSilenceMs = 0,
): TranscriptionBatch | undefined {
  if (!Number.isInteger(interSpeechSilenceMs) || interSpeechSilenceMs < 0) {
    throw new Error("O intervalo sintético entre falas é inválido");
  }
  const ordered = [...analyzedSegments].sort((left, right) =>
    compareSegments(left.segment, right.segment),
  );
  const ranges = ordered.flatMap((item) => {
    if (item.containsSpeech !== item.speechRanges.length > 0) {
      throw new Error("O resultado do detector de voz é inconsistente");
    }
    return item.speechRanges.map((range) => {
      if (
        !Number.isInteger(range.startedAtSample) ||
        !Number.isInteger(range.endedAtSample) ||
        range.startedAtSample < 0 ||
        range.endedAtSample <= range.startedAtSample ||
        range.endedAtSample > item.samples.length
      ) {
        throw new Error("O detector de voz retornou um intervalo inválido");
      }
      return { item, range };
    });
  });
  const first = ranges[0];
  if (first === undefined) {
    return undefined;
  }

  const timelineStartedAtMs =
    first.item.segment.startedAtMs + samplesToMilliseconds(first.range.startedAtSample, sampleRate);
  const silenceSampleLength = Math.round((interSpeechSilenceMs / 1_000) * sampleRate);
  const sampleLength =
    ranges.reduce(
      (total, item) => total + item.range.endedAtSample - item.range.startedAtSample,
      0,
    ) +
    silenceSampleLength * (ranges.length - 1);
  const samples = new Float32Array(sampleLength);
  const timelineSpans: TimelineSpan[] = [];
  let audioOffset = 0;
  for (const [index, { item, range }] of ranges.entries()) {
    if (index > 0) {
      audioOffset += silenceSampleLength;
    }
    const rangeSamples = item.samples.subarray(range.startedAtSample, range.endedAtSample);
    samples.set(rangeSamples, audioOffset);
    const timelineRangeStartedAtMs =
      item.segment.startedAtMs + samplesToMilliseconds(range.startedAtSample, sampleRate);
    timelineSpans.push({
      audioEndedAtMs: samplesToMilliseconds(audioOffset + rangeSamples.length, sampleRate),
      audioStartedAtMs: samplesToMilliseconds(audioOffset, sampleRate),
      timelineEndedAtMs:
        timelineRangeStartedAtMs + samplesToMilliseconds(rangeSamples.length, sampleRate),
      timelineStartedAtMs: timelineRangeStartedAtMs,
    });
    audioOffset += rangeSamples.length;
  }
  const lastSpan = timelineSpans.at(-1);
  if (lastSpan === undefined) {
    throw new Error("O lote de transcrição não contém intervalos de voz");
  }

  return {
    audio: createPcm16Wav(samples, sampleRate),
    audioDurationMs: Math.round(lastSpan.audioEndedAtMs),
    durationMs: Math.round(lastSpan.timelineEndedAtMs - timelineStartedAtMs),
    representativeSegmentId: first.item.segment.segmentId,
    segmentIds: ordered.map((item) => item.segment.segmentId),
    timelineSpans,
    timelineStartedAtMs,
  };
}

export function mapTranscriptPiecesToTimeline(
  batch: TranscriptionBatch,
  pieces: readonly TranscriptPiece[],
): TranscriptPiece[] {
  const audioDurationMs = batch.timelineSpans.at(-1)?.audioEndedAtMs;
  if (audioDurationMs === undefined) {
    throw new Error("O lote de transcrição não possui mapa temporal");
  }
  return pieces.map((piece) => {
    if (
      piece.startedAtMs < 0 ||
      piece.endedAtMs <= piece.startedAtMs ||
      piece.endedAtMs > audioDurationMs + 100
    ) {
      throw new Error("A transcrição retornou timestamp fora do áudio consolidado");
    }
    const startedAtMs = mapTimestamp(batch, Math.min(piece.startedAtMs, audioDurationMs), "start");
    const endedAtMs = mapTimestamp(batch, Math.min(piece.endedAtMs, audioDurationMs), "end");
    if (endedAtMs <= startedAtMs) {
      throw new Error("A transcrição retornou timestamp incompatível com o mapa temporal");
    }
    return { endedAtMs, startedAtMs, text: piece.text };
  });
}

function mapTimestamp(
  batch: TranscriptionBatch,
  timestampMs: number,
  boundary: "end" | "start",
): number {
  const spanIndex = batch.timelineSpans.findIndex((item) =>
    boundary === "start" ? timestampMs < item.audioEndedAtMs : timestampMs <= item.audioEndedAtMs,
  );
  const span = spanIndex === -1 ? batch.timelineSpans.at(-1) : batch.timelineSpans[spanIndex];
  if (span === undefined) {
    throw new Error("O lote de transcrição não possui mapa temporal");
  }
  if (timestampMs < span.audioStartedAtMs) {
    if (boundary === "start") {
      return Math.round(span.timelineStartedAtMs - batch.timelineStartedAtMs);
    }
    const previous = batch.timelineSpans[spanIndex - 1];
    return Math.round(
      (previous?.timelineEndedAtMs ?? span.timelineStartedAtMs) - batch.timelineStartedAtMs,
    );
  }
  const offset = Math.max(
    0,
    Math.min(timestampMs - span.audioStartedAtMs, span.audioEndedAtMs - span.audioStartedAtMs),
  );
  return Math.round(span.timelineStartedAtMs + offset - batch.timelineStartedAtMs);
}

function createPcm16Wav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  for (const [index, sample] of samples.entries()) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const integer = Math.round(clamped < 0 ? clamped * 32_768 : clamped * 32_767);
    buffer.writeInt16LE(integer, 44 + index * bytesPerSample);
  }
  return buffer;
}

function samplesToMilliseconds(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1_000;
}

function speechTimelineBounds(
  analyzed: AnalyzedSegment,
  sampleRate: number,
): { endedAtMs: number; startedAtMs: number } {
  const first = analyzed.speechRanges[0];
  const last = analyzed.speechRanges.at(-1);
  if (first === undefined || last === undefined) {
    throw new Error("O resultado do detector de voz é inconsistente");
  }
  return {
    endedAtMs: analyzed.segment.startedAtMs + samplesToMilliseconds(last.endedAtSample, sampleRate),
    startedAtMs:
      analyzed.segment.startedAtMs + samplesToMilliseconds(first.startedAtSample, sampleRate),
  };
}

function compareAnalyzedSegments(
  left: AnalyzedSegment | undefined,
  right: AnalyzedSegment | undefined,
  sampleRate: number,
): number {
  if (left === undefined || right === undefined) {
    return 0;
  }
  return (
    speechTimelineBounds(left, sampleRate).startedAtMs -
      speechTimelineBounds(right, sampleRate).startedAtMs ||
    left.segment.segmentId.localeCompare(right.segment.segmentId)
  );
}

function compareSegments(
  left: RecordingSegment | undefined,
  right: RecordingSegment | undefined,
): number {
  if (left === undefined || right === undefined) {
    return 0;
  }
  return left.startedAtMs - right.startedAtMs || left.segmentId.localeCompare(right.segmentId);
}
