import { z } from "zod";

import type { TranscriptionProvider, TranscriptPiece } from "./transcription-provider.js";
import { IncompatibleTranscriptionResponseError } from "./transcription-provider.js";

const MAX_LOGGED_INVALID_TIMESTAMPS = 20;

const timedTextSchema = z.object({
  end: z.number().nonnegative(),
  start: z.number().nonnegative(),
  text: z.string().optional(),
  word: z.string().optional(),
});

export const responseSchema = z.object({
  language: z.string().min(2).max(64).optional(),
  language_probability: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  segments: z.array(timedTextSchema).optional(),
  text: z.string(),
  usage: z.object({ cost: z.number().nonnegative() }).passthrough().optional(),
  words: z.array(timedTextSchema).optional(),
});

export type ParsedTranscriptionResponse = z.infer<typeof responseSchema>;

interface RejectedResponseDiagnosticInput {
  configuredModel: string;
  generationId: string | undefined;
  input: Parameters<TranscriptionProvider["transcribe"]>[0];
  parsed: z.infer<typeof responseSchema>;
  providerAttempt: number;
  reason: IncompatibleTranscriptionResponseError["reason"];
}

export function createRejectedResponseDiagnostic(input: RejectedResponseDiagnosticInput) {
  const invalidTimestamps = (input.parsed.words ?? [])
    .map((word, index) => createInvalidTimestampDiagnostic(word, index))
    .filter((item) => item !== undefined);
  return {
    ...createRejectedResponseBase(input),
    ...(input.parsed.model === undefined ? {} : { effectiveModel: input.parsed.model }),
    invalidTimestampCount: invalidTimestamps.length,
    invalidTimestamps: invalidTimestamps.slice(0, MAX_LOGGED_INVALID_TIMESTAMPS),
    invalidTimestampsTruncated: invalidTimestamps.length > MAX_LOGGED_INVALID_TIMESTAMPS,
    responseSegmentCount: input.parsed.segments?.length ?? 0,
    responseTextLength: input.parsed.text.length,
    responseWordCount: input.parsed.words?.length ?? 0,
  };
}

export function createRejectedResponseBase(input: Omit<RejectedResponseDiagnosticInput, "parsed">) {
  return {
    ...(input.input.audioDurationMs === undefined
      ? {}
      : { audioDurationMs: input.input.audioDurationMs }),
    configuredModel: input.configuredModel,
    ...(input.generationId === undefined ? {} : { generationId: input.generationId }),
    incompatibilityReason: input.reason,
    provider: "openrouter",
    providerAttempt: input.providerAttempt,
  };
}

function createInvalidTimestampDiagnostic(item: z.infer<typeof timedTextSchema>, index: number) {
  const startedAtMs = Math.round(item.start * 1_000);
  const endedAtMs = Math.round(item.end * 1_000);
  if (endedAtMs > startedAtMs) return undefined;
  return {
    endedAtMs,
    endSeconds: item.end,
    index,
    issue: item.end <= item.start ? "non_positive_duration" : "collapsed_after_rounding",
    startedAtMs,
    startSeconds: item.start,
  };
}

export function parseTranscriptPieces(
  parsed: z.infer<typeof responseSchema>,
  audioDurationMs: number | undefined,
): {
  pieces: TranscriptPiece[];
  usedAudioDurationFallback: boolean;
  words: TranscriptPiece[];
} {
  const wordsResult = parseTimedItems(parsed.words);
  if (wordsResult?.success === true) {
    const words = parsed.words?.map(toTranscriptPiece) ?? [];
    return { pieces: wordsResult.pieces, usedAudioDurationFallback: false, words };
  }
  if (wordsResult === undefined) {
    const text = parsed.text.trim();
    if (text.length === 0) {
      return { pieces: [], usedAudioDurationFallback: false, words: [] };
    }
    throw new IncompatibleTranscriptionResponseError("missing_timestamps");
  }
  const text = parsed.text.trim();
  if (canUseAudioDurationFallback(wordsResult.reason, parsed.words, text, audioDurationMs)) {
    return {
      pieces: [{ endedAtMs: audioDurationMs, startedAtMs: 0, text }],
      usedAudioDurationFallback: true,
      words: [],
    };
  }
  throw new IncompatibleTranscriptionResponseError(wordsResult.reason);
}

function canUseAudioDurationFallback(
  reason: "invalid_response_shape" | "invalid_timestamps",
  words: ParsedTranscriptionResponse["words"],
  text: string,
  audioDurationMs: number | undefined,
): audioDurationMs is number {
  if (reason !== "invalid_timestamps") return false;
  if (!hasOnlyZeroLengthOriginTimestamps(words) || text.length === 0) return false;
  return audioDurationMs !== undefined && Number.isFinite(audioDurationMs) && audioDurationMs > 0;
}

function hasOnlyZeroLengthOriginTimestamps(
  items: readonly z.infer<typeof timedTextSchema>[] | undefined,
): boolean {
  const invalidItems = (items ?? []).filter((item) => hasInvalidTimestamp(toTranscriptPiece(item)));
  return (
    invalidItems.length > 0 && invalidItems.every((item) => item.start === 0 && item.end === 0)
  );
}

type TimedItemsResult =
  | { pieces: TranscriptPiece[]; success: true }
  | { reason: "invalid_response_shape" | "invalid_timestamps"; success: false };

function parseTimedItems(
  items: readonly z.infer<typeof timedTextSchema>[] | undefined,
): TimedItemsResult | undefined {
  if (items === undefined || !items.some((item) => getTimedItemText(item).length > 0)) {
    return undefined;
  }
  if (items.some((item) => getTimedItemText(item).length === 0)) {
    return { reason: "invalid_response_shape", success: false };
  }
  const rawPieces = items.map((item) => toTranscriptPiece(item));
  if (rawPieces.some(hasInvalidTimestamp)) {
    return { reason: "invalid_timestamps", success: false };
  }
  return {
    pieces: groupWords(items),
    success: true,
  };
}

function hasInvalidTimestamp(piece: TranscriptPiece): boolean {
  return piece.endedAtMs <= piece.startedAtMs || piece.startedAtMs < 0;
}

function getTimedItemText(item: z.infer<typeof timedTextSchema>): string {
  return (item.text ?? item.word ?? "").trim();
}

function groupWords(words: readonly z.infer<typeof timedTextSchema>[]): TranscriptPiece[] {
  const pieces: TranscriptPiece[] = [];
  let current: TranscriptPiece | undefined;
  for (const word of words) {
    const piece = toTranscriptPiece(word);
    if (current === undefined) {
      current = piece;
    } else {
      current = {
        endedAtMs: piece.endedAtMs,
        startedAtMs: current.startedAtMs,
        text: `${current.text} ${piece.text}`,
      };
    }
    if (/[.!?…]$/u.test(current.text)) {
      pieces.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) {
    pieces.push(current);
  }
  return pieces;
}

function toTranscriptPiece(item: z.infer<typeof timedTextSchema>): TranscriptPiece {
  return {
    endedAtMs: Math.round(item.end * 1_000),
    startedAtMs: Math.round(item.start * 1_000),
    text: getTimedItemText(item),
  };
}
