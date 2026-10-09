import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const cli = new URL("../scripts/ci/quality-gate-cli.ts", import.meta.url);
const source = {
  changedOversizedModuleCount: 0,
  complexityFindings: [],
  duplicateGroups: [],
  modules: [{ changed: false, path: "src/example.ts", sloc: 12 }],
  newComplexityViolations: 0,
  newDuplication: 0,
  newMaxComplexity: 4,
  repositoryDuplication: 0.4,
  repositoryMaxComplexity: 4,
};
const fixtureReports = (serverCovered: number): Readonly<Record<string, unknown>> => ({
  "quality/biome.sarif": { runs: [{ results: [] }] },
  "quality/ruff.sarif": { runs: [{ results: [] }] },
  "quality/complexipy.sarif": { runs: [{ results: [] }] },
  "quality/source-quality.json": source,
  "server/coverage/coverage-summary.json": {
    total: { lines: { covered: serverCovered, total: 100 } },
  },
  "web/coverage/coverage-summary.json": { total: { lines: { covered: 18, total: 20 } } },
  "python/coverage.json": { totals: { covered_lines: 9, num_statements: 10 } },
  "diff-coverage/server.json": { total_num_lines: 10, total_num_violations: 1 },
  "diff-coverage/web.json": { total_num_lines: 0, total_num_violations: 0 },
  "diff-coverage/python.json": { total_num_lines: 0, total_num_violations: 0 },
  "security/npm-audit.json": { vulnerabilities: {} },
  "security/pip-audit.json": { dependencies: [] },
  "security/trivy-filesystem.json": { Results: [] },
  "runtime/trivy-bot.json": { Results: [] },
  "runtime/trivy-dashboard.json": { Results: [] },
  "runtime/trivy-faster-whisper.json": { Results: [] },
});

const writeReports = async (directory: string, reports: Readonly<Record<string, unknown>>) => {
  for (const [path, value] of Object.entries(reports)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value));
  }
};

const runGate = async (directory: string, mainSha: string, eventName = "pull_request") => {
  const output = await run(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(cli),
      "reports",
      "baseline",
      "summary.md",
    ],
    {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_SHA: "b".repeat(40),
        GITHUB_REPOSITORY: "example/summyz",
        DETAILS_URL: "https://github.com/example/summyz/actions/runs/1",
        QUALITY_RESULT: "success",
        RUNTIME_RESULT: "success",
        SECURITY_RESULT: "success",
        TESTS_RESULT: "success",
        MAIN_SHA: mainSha,
        MAIN_STEPS: JSON.stringify({
          main_server_tests: {
            outcome: "failure",
            outputs: { token: "must-never-log-this-credential" },
          },
        }),
      },
    },
  );
  const result: unknown = JSON.parse(
    await readFile(join(directory, "quality-gate-result.json"), "utf8"),
  );
  return { ...output, result, markdown: await readFile(join(directory, "summary.md"), "utf8") };
};

describe("quality gate CLI comparison integration", () => {
  it("refreshes main independently, preserves approval, and never logs credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-gate-cli-"));
    try {
      await writeReports(join(directory, "reports"), fixtureReports(90));
      await writeReports(join(directory, "baseline"), {
        "quality-gate-baseline.json": {
          oversizedModuleCount: 0,
          repositoryCoverage: 1,
          repositoryDuplication: 2,
          repositoryIssueFingerprints: [],
          repositorySecurityCount: 3,
          securityFingerprints: [],
          version: 1,
        },
      });
      const mainReports = join(directory, "main-source", "artifacts", "reports");
      await writeReports(mainReports, fixtureReports(80));
      const first = await runGate(directory, "a".repeat(40));
      expect(first.result).toEqual({ passed: true, failures: [] });
      expect(first.markdown).toContain(">82.31%</a>");
      expect(first.markdown).toContain(">+7.69 pp</a>");
      expect(first.markdown).toContain("Main analysis failed");
      expect(first.stdout + first.stderr + first.markdown).not.toContain(
        "must-never-log-this-credential",
      );

      await writeReports(mainReports, fixtureReports(95));
      const second = await runGate(directory, "c".repeat(40));
      expect(second.result).toEqual(first.result);
      expect(second.markdown).toContain(">93.85%</a>");
      expect(second.markdown).toContain(">-3.85 pp</a>");
      expect(second.markdown).toContain("c".repeat(40));
      expect(second.markdown).not.toContain(`/commit/${"a".repeat(40)}`);

      const push = await runGate(directory, "", "push");
      expect(push.result).toEqual(first.result);
      expect(push.markdown).toContain(">90.00%</a>");
      expect(push.markdown).toContain(">0.00 pp</a>");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
