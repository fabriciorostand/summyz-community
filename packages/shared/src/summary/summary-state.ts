import { z } from "zod";

import { publicSummarySchema } from "./summary-result.js";

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

export const summaryLanguageValidationSchema = z.discriminatedUnion("status", [
  z.object({
    attempts: z.number().int().min(1).max(3),
    detectedLanguage: z.string().min(2),
    requestedLanguage: z.string().min(2),
    status: z.literal("confirmed"),
  }),
  z.object({
    attempts: z.literal(3),
    detectedLanguage: z.string().min(2).optional(),
    requestedLanguage: z.string().min(2),
    status: z.literal("unconfirmed"),
  }),
]);
export type SummaryLanguageValidationState = z.infer<typeof summaryLanguageValidationSchema>;

const completedSummaryStateSchema = baseSummaryStateSchema.extend({
  attempts: z.number().int().positive(),
  completedAt: z.iso.datetime(),
  effectiveLanguage: z.string().min(2).max(32),
  languageValidation: summaryLanguageValidationSchema,
  status: z.literal("completed"),
  summary: publicSummarySchema,
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
  summary: z.infer<typeof publicSummarySchema>,
  attempts: number,
  now: string,
  languageValidation: SummaryLanguageValidationState,
): CompletedSummaryState {
  return completedSummaryStateSchema.parse({
    attempts,
    completedAt: now,
    effectiveLanguage:
      languageValidation.status === "confirmed"
        ? languageValidation.requestedLanguage
        : (languageValidation.detectedLanguage ?? "und"),
    languageValidation,
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
