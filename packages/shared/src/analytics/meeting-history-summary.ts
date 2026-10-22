import { z } from "zod";

import type { PublicSummary } from "../summary/summary-result.js";
import { summaryStateSchema } from "../summary/summary-state.js";

const retainedMeetingManifestSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
});

export type MeetingHistorySummary =
  | ({
      language: string;
      languageWarning?: { detectedLanguage?: string; requestedLanguage: string };
      status: "completed";
    } & PublicSummary)
  | { language: string; status: "failed" };

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
    ...state.summary,
    language: state.effectiveLanguage,
    ...(state.languageValidation.status === "unconfirmed"
      ? {
          languageWarning: {
            ...(state.languageValidation.detectedLanguage === undefined
              ? {}
              : { detectedLanguage: state.languageValidation.detectedLanguage }),
            requestedLanguage: state.languageValidation.requestedLanguage,
          },
        }
      : {}),
    status: "completed",
  };
}
