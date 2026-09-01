import { describe, expect, it } from "vitest";

import {
  createSummaryState,
  markSummaryCompleted,
  markSummaryFailed,
  markTranslationCompleted,
  markTranslationFailed,
} from "../src/summary/summary-state.js";

describe("estado do resumo", () => {
  it("descarta evidências antes da persistência e contabiliza tentativas", () => {
    const state = createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z");
    const completed = markSummaryCompleted(
      state,
      {
        decisions: ["Adotar o fluxo."],
        discussedTopics: ["Fluxo"],
        executiveSummary: "A equipe decidiu adotar o fluxo.",
        observations: [],
        tasks: [],
      },
      2,
      "2026-08-17T10:01:00.000Z",
      "pt",
      "auto",
      ["Projeto Atlas"],
    );

    expect(completed).toMatchObject({ attempts: 2, status: "completed" });
    expect(completed.summary.decisions).toEqual(["Adotar o fluxo."]);
    expect(JSON.stringify(completed)).not.toContain("sourceEntryIds");
    expect(completed).toMatchObject({ baseLanguage: "pt", effectiveLanguage: "pt" });
    expect(completed.protectedTerms).toEqual(["Projeto Atlas"]);
  });

  it("registra falha terminal sem armazenar resposta do provedor", () => {
    const failed = markSummaryFailed(
      createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z"),
      "provider_failed",
      4,
      "2026-08-17T10:01:00.000Z",
    );

    expect(failed).toMatchObject({
      attempts: 4,
      failureCode: "provider_failed",
      status: "failed",
    });
    expect(failed).not.toHaveProperty("summary");
  });

  it("impede concluir ou falhar tradução quando ela não está pendente", () => {
    const completed = markSummaryCompleted(
      createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z"),
      {
        decisions: [],
        discussedTopics: [],
        executiveSummary: "Resumo.",
        observations: [],
        tasks: [],
      },
      1,
      "2026-08-17T10:01:00.000Z",
      "pt",
      "auto",
    );

    expect(() =>
      markTranslationCompleted(completed, completed.summary, 1, "2026-08-17T10:02:00.000Z"),
    ).toThrow(/pending/i);
    expect(() => markTranslationFailed(completed, 1, "2026-08-17T10:02:00.000Z")).toThrow(
      /pending/i,
    );
  });
});
