import { z } from "zod";

import { type RefinementEntry, refinementEntrySchema } from "./refinement-result.js";

const baseRefinementStateSchema = z.object({
  meetingId: z.string().min(1),
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const processingRefinementStateSchema = baseRefinementStateSchema.extend({
  attempts: z.literal(0),
  status: z.literal("processing"),
});

const completedRefinementStateSchema = baseRefinementStateSchema.extend({
  attempts: z.number().int().nonnegative(),
  completedAt: z.iso.datetime(),
  entries: z.array(refinementEntrySchema),
  status: z.literal("completed"),
});

const fallbackRefinementStateSchema = baseRefinementStateSchema.extend({
  attempts: z.number().int().positive(),
  completedAt: z.iso.datetime(),
  entries: z.array(refinementEntrySchema),
  failureCode: z.literal("provider_failed"),
  status: z.literal("fallback"),
});

export const refinementStateSchema = z.discriminatedUnion("status", [
  processingRefinementStateSchema,
  completedRefinementStateSchema,
  fallbackRefinementStateSchema,
]);
export type RefinementState = z.infer<typeof refinementStateSchema>;
export type TerminalRefinementState = z.infer<
  typeof completedRefinementStateSchema | typeof fallbackRefinementStateSchema
>;

export function createRefinementState(meetingId: string, now: string): RefinementState {
  return processingRefinementStateSchema.parse({
    attempts: 0,
    meetingId,
    schemaVersion: 1,
    startedAt: now,
    status: "processing",
    updatedAt: now,
  });
}

export function markRefinementCompleted(
  state: RefinementState,
  entries: readonly RefinementEntry[],
  attempts: number,
  now: string,
): TerminalRefinementState {
  return completedRefinementStateSchema.parse({
    attempts,
    completedAt: now,
    entries,
    meetingId: state.meetingId,
    schemaVersion: state.schemaVersion,
    startedAt: state.startedAt,
    status: "completed",
    updatedAt: now,
  });
}

export function markRefinementFallback(
  state: RefinementState,
  entries: readonly RefinementEntry[],
  attempts: number,
  now: string,
): TerminalRefinementState {
  return fallbackRefinementStateSchema.parse({
    attempts,
    completedAt: now,
    entries,
    failureCode: "provider_failed",
    meetingId: state.meetingId,
    schemaVersion: state.schemaVersion,
    startedAt: state.startedAt,
    status: "fallback",
    updatedAt: now,
  });
}
