import { z } from "zod";

import { summaryDraftSchema } from "./summary-result.js";

export const summaryFailureCodeSchema = z.enum(["provider_failed", "storage_failed"]);
export type SummaryFailureCode = z.infer<typeof summaryFailureCodeSchema>;

const baseSummaryStateSchema = z.object({
  meetingId: z.string().min(1),
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const processingSummaryStateSchema = baseSummaryStateSchema.extend({
  attempts: z.literal(0),
  status: z.literal("processing"),
});

const completedSummaryStateSchema = baseSummaryStateSchema.extend({
  attempts: z.number().int().positive(),
  completedAt: z.iso.datetime(),
  status: z.literal("completed"),
  summary: summaryDraftSchema,
});
export type CompletedSummaryState = z.infer<typeof completedSummaryStateSchema>;

const failedSummaryStateSchema = baseSummaryStateSchema.extend({
  attempts: z.number().int().nonnegative(),
  failedAt: z.iso.datetime(),
  failureCode: summaryFailureCodeSchema,
  status: z.literal("failed"),
});
export type FailedSummaryState = z.infer<typeof failedSummaryStateSchema>;

export const summaryStateSchema = z.discriminatedUnion("status", [
  processingSummaryStateSchema,
  completedSummaryStateSchema,
  failedSummaryStateSchema,
]);
export type SummaryState = z.infer<typeof summaryStateSchema>;

export function createSummaryState(meetingId: string, now: string): SummaryState {
  return processingSummaryStateSchema.parse({
    attempts: 0,
    meetingId,
    schemaVersion: 1,
    startedAt: now,
    status: "processing",
    updatedAt: now,
  });
}

export function markSummaryCompleted(
  state: SummaryState,
  summary: z.infer<typeof summaryDraftSchema>,
  attempts: number,
  now: string,
): CompletedSummaryState {
  return completedSummaryStateSchema.parse({
    attempts,
    completedAt: now,
    meetingId: state.meetingId,
    schemaVersion: state.schemaVersion,
    startedAt: state.startedAt,
    status: "completed",
    summary,
    updatedAt: now,
  });
}

export function markSummaryFailed(
  state: SummaryState,
  failureCode: SummaryFailureCode,
  attempts: number,
  now: string,
): FailedSummaryState {
  return failedSummaryStateSchema.parse({
    attempts,
    failedAt: now,
    failureCode,
    meetingId: state.meetingId,
    schemaVersion: state.schemaVersion,
    startedAt: state.startedAt,
    status: "failed",
    updatedAt: now,
  });
}
