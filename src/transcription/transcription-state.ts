import { z } from "zod";

import type { TranscriptionProviderResult } from "./transcription-provider.js";
import {
  type TranscriptionRecoveryReason,
  transcriptionRecoveryReasonSchema,
} from "./transcription-recovery-policy.js";

export const transcriptionFailureCodeSchema = z.enum([
  "audio_analysis_failed",
  "audio_conversion_failed",
  "language_detection_failed",
  "provider_failed",
  "storage_failed",
]);
export type TranscriptionFailureCode = z.infer<typeof transcriptionFailureCodeSchema>;

const transcriptPieceSchema = z
  .object({
    endedAtMs: z.number().int().positive(),
    startedAtMs: z.number().int().nonnegative(),
    text: z.string().min(1),
  })
  .refine((piece) => piece.endedAtMs > piece.startedAtMs, "Timestamp de trecho inválido");

const pendingSegmentSchema = z.object({
  attempts: z.literal(0),
  pieces: z.array(z.never()).length(0),
  segmentId: z.string().min(1),
  status: z.literal("pending"),
});

const completedSegmentSchema = z
  .object({
    attempts: z.number().int().nonnegative(),
    audioDurationMs: z.number().int().positive().optional(),
    pieces: z.array(transcriptPieceSchema),
    words: z.array(transcriptPieceSchema).default([]),
    segmentId: z.string().min(1),
    status: z.literal("completed"),
    timelineStartedAtMs: z.number().int().nonnegative().optional(),
  })
  .refine(
    (segment) =>
      (segment.audioDurationMs === undefined) === (segment.timelineStartedAtMs === undefined),
    "A origem temporal do lote está incompleta",
  )
  .refine(
    (segment) => segment.attempts > 0 || segment.pieces.length === 0,
    "Um segmento não enviado ao provedor não pode conter texto",
  );

export const transcriptionSegmentStateSchema = z.discriminatedUnion("status", [
  pendingSegmentSchema,
  completedSegmentSchema,
]);
export type TranscriptionSegmentState = z.infer<typeof transcriptionSegmentStateSchema>;

export const transcriptionStateSchema = z.object({
  completedAt: z.iso.datetime().optional(),
  failedAt: z.iso.datetime().optional(),
  failureCode: transcriptionFailureCodeSchema.optional(),
  meetingId: z.string().min(1),
  schemaVersion: z.literal(1),
  segments: z.array(transcriptionSegmentStateSchema),
  startedAt: z.iso.datetime(),
  status: z.enum(["processing", "completed", "failed"]),
  transcriptionRecoveryReason: transcriptionRecoveryReasonSchema.optional(),
  updatedAt: z.iso.datetime(),
  wordTimingAvailable: z.boolean().default(false),
});
export type TranscriptionState = z.infer<typeof transcriptionStateSchema>;

export function createTranscriptionState(
  meetingId: string,
  segmentIds: readonly string[],
  now: string,
): TranscriptionState {
  if (new Set(segmentIds).size !== segmentIds.length) {
    throw new Error("A reunião contém identificadores de segmento duplicados");
  }
  return transcriptionStateSchema.parse({
    meetingId,
    schemaVersion: 1,
    segments: segmentIds.map((segmentId) => ({
      attempts: 0,
      pieces: [],
      segmentId,
      status: "pending",
    })),
    startedAt: now,
    status: "processing",
    updatedAt: now,
    wordTimingAvailable: true,
  });
}

export function completeTranscriptionSegment(
  state: TranscriptionState,
  segmentId: string,
  result: TranscriptionProviderResult,
  now: string,
): TranscriptionState {
  return completeTranscriptionGroup(
    state,
    { representativeSegmentId: segmentId, result, segmentIds: [segmentId] },
    now,
  );
}

interface CompleteTranscriptionGroupInput {
  audioDurationMs?: number;
  representativeSegmentId: string;
  result: TranscriptionProviderResult;
  segmentIds: readonly string[];
  timelineStartedAtMs?: number;
}

export function completeTranscriptionGroup(
  state: TranscriptionState,
  input: CompleteTranscriptionGroupInput,
  now: string,
): TranscriptionState {
  const segmentIds = new Set(input.segmentIds);
  if (
    segmentIds.size === 0 ||
    segmentIds.size !== input.segmentIds.length ||
    !segmentIds.has(input.representativeSegmentId) ||
    (input.audioDurationMs === undefined) !== (input.timelineStartedAtMs === undefined)
  ) {
    throw new Error("O lote de transcrição é inválido");
  }
  for (const segmentId of segmentIds) {
    const segment = state.segments.find((item) => item.segmentId === segmentId);
    if (segment === undefined) {
      throw new Error("O segmento não pertence ao processamento da reunião");
    }
    if (segment.status !== "pending") {
      throw new Error("O segmento não está pendente nesta reunião");
    }
  }

  const segments = state.segments.map((segment) => {
    if (!segmentIds.has(segment.segmentId)) {
      return segment;
    }
    if (segment.segmentId !== input.representativeSegmentId) {
      return {
        attempts: 0,
        pieces: [],
        segmentId: segment.segmentId,
        status: "completed" as const,
      };
    }
    return {
      attempts: input.result.attempts,
      ...(input.audioDurationMs === undefined ? {} : { audioDurationMs: input.audioDurationMs }),
      pieces: input.result.pieces,
      segmentId: segment.segmentId,
      status: "completed" as const,
      words: input.result.words ?? [],
      ...(input.timelineStartedAtMs === undefined
        ? {}
        : { timelineStartedAtMs: input.timelineStartedAtMs }),
    };
  });
  return transcriptionStateSchema.parse({ ...state, segments, updatedAt: now });
}

export function markTranscriptionCompleted(
  state: TranscriptionState,
  now: string,
): TranscriptionState {
  if (state.segments.some((segment) => segment.status !== "completed")) {
    throw new Error("A transcrição não pode ser concluída com segmentos pendentes");
  }
  return transcriptionStateSchema.parse({
    ...state,
    completedAt: now,
    status: "completed",
    updatedAt: now,
    wordTimingAvailable: state.wordTimingAvailable,
  });
}

export function markTranscriptionFailed(
  state: TranscriptionState,
  failureCode: TranscriptionFailureCode,
  now: string,
  transcriptionRecoveryReason?: TranscriptionRecoveryReason,
): TranscriptionState {
  return transcriptionStateSchema.parse({
    ...state,
    failedAt: now,
    failureCode,
    status: "failed",
    ...(transcriptionRecoveryReason === undefined ? {} : { transcriptionRecoveryReason }),
    updatedAt: now,
  });
}

export function retryFailedTranscription(
  state: TranscriptionState,
  now: string,
): TranscriptionState {
  if (state.status !== "failed" || state.failureCode !== "provider_failed") {
    throw new Error("Somente uma falha do provedor pode entrar em retry durável");
  }
  return transcriptionStateSchema.parse({
    meetingId: state.meetingId,
    schemaVersion: state.schemaVersion,
    segments: state.segments,
    startedAt: state.startedAt,
    status: "processing",
    updatedAt: now,
    wordTimingAvailable: state.wordTimingAvailable,
  });
}
