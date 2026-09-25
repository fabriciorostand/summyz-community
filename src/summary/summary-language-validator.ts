import { franc } from "franc";

import type { PublicSummary } from "./summary-result.js";

export type SummaryLanguageValidation =
  | { detectedLanguage: string; status: "confirmed" | "wrong" }
  | { status: "inconclusive" };

const minimumSampleLength = 80;
const primaryByDetectedCode: Readonly<Record<string, string>> = {
  arb: "ar",
  ces: "cs",
  cmn: "zh",
  dan: "da",
  deu: "de",
  ell: "el",
  eng: "en",
  fin: "fi",
  fra: "fr",
  heb: "he",
  hin: "hi",
  hun: "hu",
  ind: "id",
  ita: "it",
  jpn: "ja",
  kor: "ko",
  nld: "nl",
  nno: "no",
  nob: "no",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rus: "ru",
  spa: "es",
  swe: "sv",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  vie: "vi",
};

export function validateSummaryLanguage(
  summary: PublicSummary,
  expectedLanguage: string,
): SummaryLanguageValidation {
  const expectedPrimary = expectedLanguage.split("-")[0]?.toLowerCase();
  if (expectedPrimary === undefined || expectedPrimary === "auto") {
    throw new Error("A concrete summary language is required for validation");
  }
  const fields = [
    summary.executiveSummary,
    ...summary.discussedTopics,
    ...summary.decisions,
    ...summary.tasks.map((task) => task.text),
    ...summary.observations,
  ];
  const combined = detectLanguage(fields.join(" "));
  if (combined === undefined) return { status: "inconclusive" };
  if (combined !== expectedPrimary) return { detectedLanguage: combined, status: "wrong" };
  for (const field of fields) {
    const detected = detectLanguage(field);
    if (detected !== undefined && detected !== expectedPrimary) {
      return { detectedLanguage: detected, status: "wrong" };
    }
  }
  return { detectedLanguage: combined, status: "confirmed" };
}

function detectLanguage(text: string): string | undefined {
  if (text.trim().length < minimumSampleLength) return undefined;
  const detected = franc(text, { minLength: minimumSampleLength });
  return detected === "und" ? undefined : (primaryByDetectedCode[detected] ?? detected);
}
