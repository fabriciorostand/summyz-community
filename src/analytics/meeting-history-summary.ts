import { z } from "zod";

import type { PublicSummary } from "../summary/summary-result.js";
import { createPublicSummary, summaryDraftSchema } from "../summary/summary-result.js";
import { summaryStateSchema } from "../summary/summary-state.js";

const retainedMeetingManifestSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
});

export type MeetingHistorySummary =
  | ({ language: string; status: "completed" } & PublicSummary)
  | { language: string; status: "failed" };

const legacyCompletedSummaryStateSchema = z.object({
  status: z.literal("completed"),
  summary: summaryDraftSchema,
});

export function createMeetingHistorySummary(
  summaryState: unknown,
  meetingManifest: unknown,
): MeetingHistorySummary {
  const { botLanguage: language } = retainedMeetingManifestSchema.parse(meetingManifest);
  const currentState = summaryStateSchema.safeParse(summaryState);
  if (!currentState.success) {
    const legacy = legacyCompletedSummaryStateSchema.parse(summaryState);
    return {
      ...createPublicSummary(legacy.summary),
      language,
      status: "completed",
    };
  }
  const state = currentState.data;
  if (state.status === "processing") {
    throw new Error("A retained meeting summary cannot still be processing");
  }
  if (state.status === "failed") return { language, status: "failed" };
  return {
    ...state.summary,
    language: state.effectiveLanguage,
    status: "completed",
  };
}
