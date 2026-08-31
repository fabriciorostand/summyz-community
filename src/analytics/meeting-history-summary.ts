import { z } from "zod";

import { createPublicSummary, type PublicSummary } from "../summary/summary-result.js";
import { summaryStateSchema } from "../summary/summary-state.js";

const retainedMeetingManifestSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
});

export type MeetingHistorySummary =
  | ({ language: "en" | "pt-BR"; status: "completed" } & PublicSummary)
  | { language: "en" | "pt-BR"; status: "failed" };

export function createMeetingHistorySummary(
  summaryState: unknown,
  meetingManifest: unknown,
): MeetingHistorySummary {
  const { botLanguage: language } = retainedMeetingManifestSchema.parse(meetingManifest);
  const state = summaryStateSchema.parse(summaryState);
  if (state.status === "processing") {
    throw new Error("A retained meeting summary cannot still be processing");
  }
  if (state.status === "failed") return { language, status: "failed" };
  return {
    ...createPublicSummary(state.summary),
    language,
    status: "completed",
  };
}
