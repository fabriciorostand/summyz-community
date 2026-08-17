import { describe, expect, it } from "vitest";

import {
  createSummaryState,
  markSummaryCompleted,
  markSummaryFailed,
} from "../src/summary/summary-state.js";

describe("estado do resumo", () => {
  it("persiste um resultado fundamentado e contabiliza tentativas", () => {
    const state = createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z");
    const completed = markSummaryCompleted(
      state,
      {
        decisions: [{ sourceEntryIds: ["entry-1"], text: "Adotar o fluxo." }],
        discussedTopics: ["Fluxo"],
        executiveSummary: "A equipe decidiu adotar o fluxo.",
        observations: [],
        tasks: [],
      },
      2,
      "2026-08-17T10:01:00.000Z",
    );

    expect(completed).toMatchObject({ attempts: 2, status: "completed" });
    expect(completed.summary?.decisions[0]?.sourceEntryIds).toEqual(["entry-1"]);
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
});
