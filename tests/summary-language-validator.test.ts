import { describe, expect, it } from "vitest";

import { validateSummaryLanguage } from "../src/summary/summary-language-validator.js";
import type { PublicSummary } from "../src/summary/summary-result.js";

function summary(executiveSummary: string): PublicSummary {
  return {
    decisions: [],
    discussedTopics: [],
    executiveSummary,
    observations: [],
    tasks: [],
  };
}

describe("validateSummaryLanguage", () => {
  it("confirms the primary language for a regional target", () => {
    expect(
      validateSummaryLanguage(
        summary(
          "A equipe aprovou o cronograma de lançamento proposto e atribuiu a atualização da documentação ao time de engenharia.",
        ),
        "pt-BR",
      ),
    ).toEqual({ detectedLanguage: "pt", status: "confirmed" });
  });

  it("rejects a different primary language", () => {
    expect(
      validateSummaryLanguage(
        summary(
          "A equipe aprovou o cronograma de lançamento proposto e atribuiu a atualização da documentação ao time de engenharia.",
        ),
        "en",
      ),
    ).toEqual({ detectedLanguage: "pt", status: "wrong" });
  });

  it("leaves short summaries inconclusive", () => {
    expect(validateSummaryLanguage(summary("Aprovado."), "pt-BR")).toEqual({
      status: "inconclusive",
    });
  });

  it("checks long fields even when the combined text matches", () => {
    const candidate = {
      ...summary(
        "The team approved the release schedule and assigned the documentation update to engineering. The final decision was recorded for the next planning meeting.",
      ),
      observations: [
        "A equipe também discutiu os riscos do lançamento e decidiu revisar os prazos antes da próxima reunião de planejamento.",
      ],
    };
    expect(validateSummaryLanguage(candidate, "en").status).toBe("wrong");
  });
});
