import type { MeetingSummaryGenerator } from "summyz-community-bot/summary/meeting-summary-generator";
import {
  type SummaryDraft,
  summaryDraftSchema,
} from "summyz-community-shared/summary/summary-result";
import { taskOwners } from "summyz-community-shared/summary/task-presentation";
import { z } from "zod";
import {
  type ExpectedTask,
  type SummaryEvaluationCase,
  summaryEvaluationCaseSchema,
} from "./summary-cases.js";

type Task = SummaryDraft["tasks"][number];
export interface EvaluationIssue {
  code: "missing_task" | "unexpected_task" | "owners" | "deadline";
  sourceEntryIds: string[];
  expected: string | null;
  actual: string | null;
}
export interface EvaluationResult {
  caseId: string;
  name: string;
  run: number;
  status: "passed" | "failed" | "review" | "error";
  issues: EvaluationIssue[];
  actual: Task[];
  variant: number | null;
  reviewReason?: string;
}

function compareTask(actual: Task, expected: ExpectedTask): EvaluationIssue[] {
  const ownerSet = (names: readonly string[]) => JSON.stringify([...names].sort());
  const issue = { sourceEntryIds: expected.sourceEntryIds };
  return [
    ...(ownerSet(taskOwners(actual)) === ownerSet(expected.ownerNames)
      ? []
      : [
          {
            ...issue,
            code: "owners" as const,
            expected: ownerSet(expected.ownerNames),
            actual: ownerSet(taskOwners(actual)),
          },
        ]),
    ...((actual.deadlineDate ?? actual.deadlineText ?? null) === expected.deadlineDate
      ? []
      : [
          {
            ...issue,
            code: "deadline" as const,
            expected: expected.deadlineDate,
            actual: actual.deadlineDate ?? actual.deadlineText ?? null,
          },
        ]),
  ];
}
function compareVariant(
  tasks: readonly Task[],
  expected: readonly ExpectedTask[],
): EvaluationIssue[] {
  const remaining = new Set(tasks);
  const issues: EvaluationIssue[] = [];
  for (const target of expected) {
    const task = [...remaining]
      .filter((candidate) =>
        candidate.sourceEntryIds.some((id) => target.sourceEntryIds.includes(id)),
      )
      .sort(
        (left, right) => compareTask(left, target).length - compareTask(right, target).length,
      )[0];
    if (task === undefined) {
      issues.push({
        code: "missing_task",
        sourceEntryIds: target.sourceEntryIds,
        expected: JSON.stringify(target),
        actual: null,
      });
    } else {
      remaining.delete(task);
      issues.push(...compareTask(task, target));
    }
  }
  return [
    ...issues,
    ...[...remaining].map(
      (task): EvaluationIssue => ({
        code: "unexpected_task",
        sourceEntryIds: task.sourceEntryIds,
        expected: null,
        actual: task.text,
      }),
    ),
  ];
}

export function assessSummary(input: SummaryEvaluationCase, summary: SummaryDraft) {
  const scenario = summaryEvaluationCaseSchema.parse(input);
  const actual = summaryDraftSchema.parse(summary).tasks;
  const best = scenario.variants
    .map((variant, index) => ({ variant: index, issues: compareVariant(actual, variant) }))
    .reduce((left, right) => (right.issues.length < left.issues.length ? right : left));
  const status =
    best.issues.length > 0 ? "failed" : scenario.reviewReason === undefined ? "passed" : "review";
  return { ...best, actual, status } as const;
}

async function evaluateRun(
  scenario: SummaryEvaluationCase,
  run: number,
  generator: Pick<MeetingSummaryGenerator, "generate">,
): Promise<EvaluationResult> {
  const identity = {
    caseId: scenario.id,
    name: scenario.name,
    run,
    ...(scenario.reviewReason === undefined ? {} : { reviewReason: scenario.reviewReason }),
  };
  try {
    const { summary } = await generator.generate(scenario.entries);
    return { ...identity, ...assessSummary(scenario, summary) };
  } catch {
    // Provider errors may contain credentials or headers; persist only a fixed classification.
    return { ...identity, status: "error", issues: [], actual: [], variant: null };
  }
}

function semanticSignature(result: EvaluationResult): string {
  return JSON.stringify({
    status: result.status,
    tasks: result.actual
      .map((task) => ({
        ownerNames: [...taskOwners(task)].sort(),
        deadlineDate: task.deadlineDate ?? null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  });
}

export async function runSummaryEvaluation(options: {
  cases: readonly SummaryEvaluationCase[];
  runs: number;
  generator: Pick<MeetingSummaryGenerator, "generate">;
  onResult?: (result: EvaluationResult) => void;
}) {
  const cases = z.array(summaryEvaluationCaseSchema).min(1).max(20).parse(options.cases);
  const runs = z.number().int().min(1).max(5).parse(options.runs);
  const results: EvaluationResult[] = [];
  for (const scenario of cases) {
    for (let run = 1; run <= runs; run += 1) {
      const result = await evaluateRun(scenario, run, options.generator);
      results.push(result);
      options.onResult?.(result);
    }
  }
  const consistency = cases.map(({ id }) => ({
    caseId: id,
    consistent:
      new Set(results.filter(({ caseId }) => caseId === id).map(semanticSignature)).size === 1,
  }));
  const failed = results.some(({ status }) => status === "failed" || status === "error");
  return {
    schemaVersion: 1,
    suiteVersion: 1,
    status: failed
      ? "failed"
      : results.some(({ status }) => status === "review")
        ? "review"
        : "passed",
    results,
    consistency,
  } as const;
}
export type SummaryEvaluation = Awaited<ReturnType<typeof runSummaryEvaluation>>;
