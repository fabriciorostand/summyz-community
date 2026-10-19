import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { summaryEvaluationCases } from "../scripts/evaluation/summary-cases.js";
import { runSummaryEvaluation } from "../scripts/evaluation/summary-evaluation.js";
import {
  parseEvaluationOptions,
  selectEvaluationCases,
} from "../scripts/evaluation/summary-options.js";
import { evaluationExitCode, writeEvaluationReport } from "../scripts/evaluation/summary-report.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
describe("summary evaluation command", () => {
  it("shows help without installation access and redacts credentials from startup error logs", () => {
    const run = (args: string[]) =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/evaluate-summary.ts", ...args], {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          DATABASE_URL: "invalid-secret-database-url",
          SUMMYZ_SECRETS_KEY: "invalid-secret-key",
        },
      });
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--profile-id");
    const failure = run(["--profile-id", "local-profile-1"]);
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('"stage":"configuration"');
    expect(failure.stdout + failure.stderr).not.toContain("invalid-secret");
    const invalidArgs = run([]);
    expect(invalidArgs.status).toBe(1);
    expect(invalidArgs.stderr).toContain('"stage":"arguments"');
  }, 35000);
  it("requires an explicit profile while allowing help and read-only profile discovery", () => {
    expect(() => parseEvaluationOptions([])).toThrow();
    expect(parseEvaluationOptions(["--help"]).command).toBe("help");
    expect(parseEvaluationOptions(["--list-profiles"]).command).toBe("list");
    expect(parseEvaluationOptions(["--profile-id", "local-profile-1"])).toMatchObject({
      command: "run",
      runs: 1,
    });
  });
  it("validates repetition, device and case selection before connecting to any provider", () => {
    const options = parseEvaluationOptions([
      "--profile-id",
      "external-profile-1",
      "--runs",
      "3",
      "--case",
      "today",
      "--case",
      "tomorrow",
    ]);
    expect(options).toMatchObject({ runs: 3, caseIds: ["today", "tomorrow"] });
    expect(selectEvaluationCases(options.caseIds).map(({ id }) => id)).toEqual([
      "today",
      "tomorrow",
    ]);
    expect(selectEvaluationCases([])).toHaveLength(summaryEvaluationCases.length);
    for (const args of [
      ["--runs", "0"],
      ["--runs", "6"],
      ["--runs", "1.5"],
      ["--device", "automatic"],
      ["--output", "../../outside"],
    ]) {
      expect(() => parseEvaluationOptions(["--profile-id", "local-profile-1", ...args])).toThrow();
    }
    expect(() => selectEvaluationCases(["unknown"])).toThrow();
    expect(() => parseEvaluationOptions(["--list-profiles", "--profile-id", "one"])).toThrow();
    expect(parseEvaluationOptions(["--profile-id", "one", "--device", "gpu"]).device).toBe("gpu");
  });
  it("writes unique JSON and readable Markdown reports with inputs, expectations and every actual result", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "summyz-evaluation-"));
    temporaryDirectories.push(directory);
    const cases = selectEvaluationCases(["no-commitment"]);
    const evaluation = await runSummaryEvaluation({
      cases,
      runs: 1,
      generator: {
        generate: async () => ({
          attempts: 1,
          summary: {
            decisions: [],
            discussedTopics: [],
            executiveSummary: "Sem compromisso",
            observations: [],
            tasks: [],
          },
        }),
      },
    });
    const target = {
      profileId: "local-profile-1",
      provider: "ollama" as const,
      model: "target",
      device: "cpu" as const,
      language: "pt-BR",
      generation: {},
      maxChunkCharacters: 500000,
      promptSha256: "a".repeat(64),
    };
    const first = await writeEvaluationReport({ directory, cases, target, evaluation });
    const second = await writeEvaluationReport({ directory, cases, target, evaluation });
    expect(first.json).not.toBe(second.json);
    expect(await readdir(directory)).toHaveLength(4);
    const json = JSON.parse(await readFile(first.json, "utf8"));
    expect(json).toMatchObject({
      target,
      evaluation: { status: "passed" },
      cases: [{ id: "no-commitment", variants: [[]] }],
    });
    expect(json.createdAt).toBeTruthy();
    const markdown = await readFile(first.markdown, "utf8");
    expect(markdown).toContain("no-commitment");
    expect(markdown).toContain("Talvez fosse interessante");
    expect(markdown).toContain("passed");
    expect(markdown).toContain("revisão humana");
    expect(markdown).toContain("Consistência");
    expect(markdown).toContain("```json");
  });
  it("distinguishes failed evaluations and pending review from automatic approval", () => {
    expect(evaluationExitCode("passed")).toBe(0);
    expect(evaluationExitCode("failed")).toBe(1);
    expect(evaluationExitCode("review")).toBe(2);
  });
  it("keeps semantic inference out of the required smoke and exposes only a manual command", async () => {
    const smoke = await readFile(
      new URL("./smoke/local-ai.smoke.test.ts", import.meta.url),
      "utf8",
    );
    expect(smoke).not.toContain("verifySummaryAssignments");
    expect(smoke).not.toContain("runSummaryEvaluation");
    expect(smoke).toContain('"qwen3:1.7b"');
    const workflow = await readFile(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).not.toContain("eval:summary");
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.scripts["eval:summary"]).toContain("scripts/evaluate-summary.ts");
  });
});
