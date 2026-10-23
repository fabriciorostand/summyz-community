import { z } from "zod";

const primaryLanguageSchema = z.string().regex(/^[a-z]{2,3}$/);

const languageNames: Readonly<Record<string, string>> = {
  arabic: "ar",
  chinese: "zh",
  czech: "cs",
  danish: "da",
  dutch: "nl",
  english: "en",
  finnish: "fi",
  french: "fr",
  german: "de",
  greek: "el",
  hebrew: "he",
  hindi: "hi",
  hungarian: "hu",
  indonesian: "id",
  italian: "it",
  japanese: "ja",
  korean: "ko",
  norwegian: "no",
  polish: "pl",
  portuguese: "pt",
  romanian: "ro",
  russian: "ru",
  spanish: "es",
  swedish: "sv",
  thai: "th",
  turkish: "tr",
  ukrainian: "uk",
  vietnamese: "vi",
};
const bcp47LanguageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?$/);

export interface LanguageEvidence {
  durationMs: number;
  language: string;
  probability?: number;
}

export interface PredominantLanguageResult {
  confidence: number;
  distribution: Record<string, number>;
  language: string;
}

export function normalizeDetectedLanguage(input: string): string {
  const normalized = input.trim();
  const named = languageNames[normalized.toLowerCase()];
  if (named !== undefined) return named;
  if (!bcp47LanguageTagSchema.safeParse(normalized).success) {
    throw new Error("The provider returned an invalid language identifier");
  }
  const primary = normalized.split("-")[0]?.toLowerCase();
  const parsed = primaryLanguageSchema.parse(primary);
  return parsed;
}

export function aggregatePredominantLanguage(
  evidence: readonly LanguageEvidence[],
): PredominantLanguageResult {
  const distribution: Record<string, number> = {};
  for (const item of evidence) {
    const language = normalizeDetectedLanguage(item.language);
    const durationMs = z.number().positive().parse(item.durationMs);
    const probability = z
      .number()
      .min(0)
      .max(1)
      .parse(item.probability ?? 1);
    distribution[language] = (distribution[language] ?? 0) + durationMs * probability;
  }
  const ranked = Object.entries(distribution).sort(
    ([languageA, scoreA], [languageB, scoreB]) =>
      scoreB - scoreA || languageA.localeCompare(languageB),
  );
  const winner = ranked[0];
  if (winner === undefined) throw new Error("No valid language evidence was produced");
  const total = ranked.reduce((sum, [, score]) => sum + score, 0);
  return {
    confidence: total === 0 ? 0 : winner[1] / total,
    distribution,
    language: winner[0],
  };
}
