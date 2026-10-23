import { describe, expect, it } from "vitest";
import { summaryEvaluationCases } from "../../../scripts/evaluation/summary-cases.js";
import {
  assessSummary,
  runSummaryEvaluation,
} from "../../../scripts/evaluation/summary-evaluation.js";
import type { SummaryDraft } from "../src/summary/summary-result.js";

const scenario = {
  id: "commitment",
  name: "Compromisso explícito",
  entries: [
    {
      id: "bruno",
      speaker: "Bruno",
      text: "Eu implemento até quarta.",
      startedAtMs: 0,
      endedAtMs: 1000,
    },
  ],
  variants: [[{ sourceEntryIds: ["bruno"], ownerNames: ["Bruno"], deadlineDate: "2026-10-21" }]],
};
function summary(tasks: SummaryDraft["tasks"]): SummaryDraft {
  return {
    decisions: [],
    discussedTopics: [],
    executiveSummary: "Planejamento",
    observations: [],
    tasks,
  };
}
const correct = {
  text: "Implementar",
  sourceEntryIds: ["bruno"],
  ownerNames: ["Bruno"],
  deadlineDate: "2026-10-21",
  deadlinePrecision: "date" as const,
  deadlineText: "quarta",
  deadlineTimeZone: "America/Sao_Paulo",
};

describe("summary semantic evaluation", () => {
  it("accepts paraphrased actions while checking evidence, names and dates", () => {
    expect(assessSummary(scenario, summary([correct]))).toMatchObject({
      status: "passed",
      issues: [],
    });
  });
  it("reports omitted and invented tasks", () => {
    expect(assessSummary(scenario, summary([])).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "missing_task" })]),
    );
    expect(assessSummary({ ...scenario, variants: [[]] }, summary([correct])).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unexpected_task" })]),
    );
  });
  it("matches tasks with overlapping evidence independently of their output order", () => {
    const sharedEvidence = {
      ...scenario,
      variants: [
        [
          { sourceEntryIds: ["bruno"], ownerNames: ["Bruno"], deadlineDate: "2026-10-21" },
          { sourceEntryIds: ["bruno"], ownerNames: ["Carla"], deadlineDate: "2026-10-21" },
        ],
      ],
    };
    expect(
      assessSummary(sharedEvidence, summary([{ ...correct, ownerNames: ["Carla"] }, correct]))
        .status,
    ).toBe("passed");
  });
  it("rejects wrong owners, dates and unsupported evidence", () => {
    const result = assessSummary(
      scenario,
      summary([{ ...correct, ownerNames: ["Carla"], deadlineDate: "2026-10-20" }]),
    );
    expect(result.issues.map(({ code }) => code)).toEqual(["owners", "deadline"]);
    expect(
      assessSummary(scenario, summary([{ ...correct, sourceEntryIds: ["unknown"] }])).issues.map(
        ({ code }) => code,
      ),
    ).toEqual(["missing_task", "unexpected_task"]);
  });
  it("checks the complete shared owner set independently of its order", () => {
    const shared = {
      ...scenario,
      variants: [
        [
          {
            ...scenario.variants[0]?.[0],
            sourceEntryIds: ["bruno"],
            ownerNames: ["Carla", "Diego"],
            deadlineDate: null,
          },
        ],
      ],
    };
    const task = { text: "Revisar", sourceEntryIds: ["bruno"], ownerNames: ["Diego", "Carla"] };
    expect(assessSummary(shared, summary([task])).status).toBe("passed");
    expect(
      assessSummary(shared, summary([{ ...task, ownerNames: ["Diego", "Carla", "Bruno"] }])).status,
    ).toBe("failed");
  });
  it("does not invent an owner or a deadline when none is expected", () => {
    const unassigned = {
      ...scenario,
      variants: [[{ sourceEntryIds: ["bruno"], ownerNames: [], deadlineDate: null }]],
    };
    expect(
      assessSummary(
        unassigned,
        summary([{ text: "Testar", sourceEntryIds: ["bruno"], ownerNames: [] }]),
      ).status,
    ).toBe("passed");
    expect(assessSummary(unassigned, summary([correct])).issues).toHaveLength(2);
  });
  it("accepts explicitly allowed interpretations but requires human review", () => {
    const ambiguous = {
      ...scenario,
      reviewReason: "Confirmar qual semana foi interpretada.",
      variants: [
        ...scenario.variants,
        [{ sourceEntryIds: ["bruno"], ownerNames: ["Bruno"], deadlineDate: "2026-10-28" }],
      ],
    };
    expect(
      assessSummary(ambiguous, summary([{ ...correct, deadlineDate: "2026-10-28" }])),
    ).toMatchObject({ status: "review", variant: 1, issues: [] });
  });
  it("rejects an invented literal deadline even without a normalized date", () => {
    const noDeadline = {
      ...scenario,
      variants: [[{ sourceEntryIds: ["bruno"], ownerNames: ["Bruno"], deadlineDate: null }]],
    };
    expect(
      assessSummary(
        noDeadline,
        summary([
          {
            text: "Implementar",
            sourceEntryIds: ["bruno"],
            ownerNames: ["Bruno"],
            deadlineText: "amanhã",
          },
        ]),
      ).status,
    ).toBe("failed");
  });
  it("reports stable passes and review outcomes to the progress callback", async () => {
    const statuses: string[] = [];
    const report = await runSummaryEvaluation({
      cases: [scenario],
      runs: 2,
      generator: { generate: async () => ({ attempts: 1, summary: summary([correct]) }) },
      onResult: ({ status }) => statuses.push(status),
    });
    expect(report.status).toBe("passed");
    expect(report.consistency[0]?.consistent).toBe(true);
    expect(statuses).toEqual(["passed", "passed"]);
    expect(
      (
        await runSummaryEvaluation({
          cases: [{ ...scenario, reviewReason: "Conferir interpretação." }],
          runs: 1,
          generator: { generate: async () => ({ attempts: 1, summary: summary([correct]) }) },
        })
      ).status,
    ).toBe("review");
  });
  it("collects every repetition and exposes inconsistent results without retrying for a pass", async () => {
    let calls = 0;
    const report = await runSummaryEvaluation({
      cases: [scenario],
      runs: 2,
      generator: {
        generate: async () => ({ attempts: 1, summary: summary(++calls === 1 ? [correct] : []) }),
      },
    });
    expect(calls).toBe(2);
    expect(report).toMatchObject({
      status: "failed",
      consistency: [{ caseId: "commitment", consistent: false }],
    });
    expect(report.results.map(({ status }) => status)).toEqual(["passed", "failed"]);
  });
  it("does not expose credentials from provider failures and continues with other cases", async () => {
    const secret = "sk-test-secret-must-never-leak";
    const report = await runSummaryEvaluation({
      cases: [scenario, { ...scenario, id: "second" }],
      runs: 1,
      generator: {
        generate: async () => {
          throw new Error(`Authorization: Bearer ${secret}`);
        },
      },
    });
    expect(report.results).toHaveLength(2);
    expect(report.results.every(({ status }) => status === "error")).toBe(true);
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain("Authorization");
  });
  it("rejects invalid repetition counts and empty suites before invoking providers", async () => {
    const generator = {
      generate: async () => {
        throw new Error("must not run");
      },
    };
    await expect(runSummaryEvaluation({ cases: [scenario], runs: 0, generator })).rejects.toThrow();
    await expect(runSummaryEvaluation({ cases: [], runs: 1, generator })).rejects.toThrow();
  });
  it("keeps the original two-task scenario and covers temporal and ownership cases", () => {
    expect(summaryEvaluationCases[0]?.variants[0]).toHaveLength(2);
    for (const id of [
      "contextual-assignments",
      "unassigned",
      "confirmation",
      "today",
      "tomorrow",
      "in-three-days",
      "no-commitment",
      "ambiguous-weekday",
    ]) {
      expect(summaryEvaluationCases.some((item) => item.id === id)).toBe(true);
    }
  });
});
