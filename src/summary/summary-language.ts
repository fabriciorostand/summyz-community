import type { ProfileLanguage } from "../ai-profile.js";

export function resolveSummaryLanguage(input: {
  detectedLanguage: string | undefined;
  summaryLanguage: ProfileLanguage;
  transcriptionLanguage: ProfileLanguage;
}): string {
  if (input.summaryLanguage !== "auto") return input.summaryLanguage;
  if (input.transcriptionLanguage !== "auto") return input.transcriptionLanguage;
  if (input.detectedLanguage !== undefined) return input.detectedLanguage;
  throw new Error("The meeting language is unavailable");
}
