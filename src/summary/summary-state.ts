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

const completedSummaryStateSchema = baseSummaryStateSchema.extend({
  attempts: z.number().int().positive(),
  baseLanguage: z.string().min(2).max(3),
  baseSummary: publicSummarySchema,
  completedAt: z.iso.datetime(),
  effectiveLanguage: z.string().min(2).max(32),
  protectedTerms: z.array(z.string().trim().min(1)).default([]),
  status: z.literal("completed"),
  summary: publicSummarySchema,
  translation: z.discriminatedUnion("status", [
    z.object({ status: z.literal("not_requested") }),
    z.object({ attempts: z.literal(0), status: z.literal("pending"), targetLanguage: z.string() }),
    z.object({
      attempts: z.number().int().positive(),
      status: z.literal("completed"),
      targetLanguage: z.string(),
    }),
    z.object({
      attempts: z.number().int().positive(),
      status: z.literal("failed"),
      targetLanguage: z.string(),
    }),
  ]),
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
  baseLanguage = "und",
  configuredLanguage = "auto",
  protectedTerms: readonly string[] = [],
): CompletedSummaryState {
  const translation =
    configuredLanguage === "auto" || configuredLanguage === baseLanguage
      ? { status: "not_requested" as const }
      : { attempts: 0 as const, status: "pending" as const, targetLanguage: configuredLanguage };
  return completedSummaryStateSchema.parse({
    attempts,
    baseLanguage,
    baseSummary: summary,
    completedAt: now,
    effectiveLanguage: baseLanguage,
    meetingId: state.meetingId,
    protectedTerms,
    schemaVersion: state.schemaVersion,
    startedAt: state.startedAt,
    status: "completed",
    summary,
    translation,
    updatedAt: now,
  });
}

export function markTranslationCompleted(
  state: CompletedSummaryState,
  summary: z.infer<typeof publicSummarySchema>,
  attempts: number,
  now: string,
): CompletedSummaryState {
  if (state.translation.status !== "pending") {
    throw new Error("Translation is not pending");
  }
  return completedSummaryStateSchema.parse({
    ...state,
    effectiveLanguage: state.translation.targetLanguage,
    summary,
    translation: {
      attempts,
      status: "completed",
      targetLanguage: state.translation.targetLanguage,
    },
    updatedAt: now,
  });
}

export function markTranslationFailed(
  state: CompletedSummaryState,
  attempts: number,
  now: string,
): CompletedSummaryState {
  if (state.translation.status !== "pending") {
    throw new Error("Translation is not pending");
  }
  return completedSummaryStateSchema.parse({
    ...state,
    effectiveLanguage: state.baseLanguage,
    summary: state.baseSummary,
    translation: {
      attempts,
      status: "failed",
      targetLanguage: state.translation.targetLanguage,
    },
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
