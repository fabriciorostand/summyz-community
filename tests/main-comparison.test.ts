import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeMainReports, loadMainComparison } from "../scripts/ci/main-comparison.js";

const sha = "a".repeat(40);
const sarif = { runs: [{ results: [] }] };
const reports = () => ({
  "quality/biome.sarif": sarif,
  "quality/ruff.sarif": sarif,
  "quality/complexipy.sarif": sarif,
  "quality/source-quality.json": {
    cognitiveComplexity: {
      repository: { maximum: 12, exact: true },
      newCode: { maximum: 0, exact: true },
    },
    modules: [{ sloc: 501 }, { sloc: 12 }],
    repositoryDuplication: 1.25,
    repositoryMaxComplexity: 7,
  },
  "server/coverage/coverage-summary.json": { total: { lines: { covered: 90, total: 100 } } },
  "web/coverage/coverage-summary.json": { total: { lines: { covered: 18, total: 20 } } },
  "python/coverage.json": { totals: { covered_lines: 9, num_statements: 10 } },
  "security/npm-audit.json": { vulnerabilities: {} },
  "security/pip-audit.json": { dependencies: [] },
  "security/trivy-filesystem.json": { Results: [] },
  "runtime/trivy-bot.json": { Results: [] },
  "runtime/trivy-dashboard.json": { Results: [] },
  "runtime/trivy-faster-whisper.json": { Results: [] },
});

describe("live main comparison", () => {
  it("keeps the available main maximum without requiring new-code measurement metadata", () => {
    const input = {
      ...reports(),
      "quality/source-quality.json": {
        ...reports()["quality/source-quality.json"],
        cognitiveComplexity: { repository: { maximum: 15, exact: true } },
      },
    };
    expect(analyzeMainReports(sha, {}, input).cognitiveComplexity).toEqual({
      maximum: 15,
      exact: true,
    });
  });
  it("computes metrics from the captured main rather than a historical baseline", () => {
    expect(analyzeMainReports(sha, {}, reports())).toMatchObject({
      commitSha: sha,
      state: "success",
      issueCount: 0,
      securityCount: 0,
      coverage: 90,
      duplication: 1.25,
      cyclomaticComplexity: 7,
      cognitiveComplexity: { maximum: 12, exact: true },
      oversizedModuleCount: 1,
      moduleCount: 2,
    });
  });

  it("retains coverage produced by failing tests and flags the failed analysis", () => {
    const result = analyzeMainReports(
      sha,
      { main_server_tests: { outcome: "failure", outputs: { secret: "must-never-appear" } } },
      reports(),
    );
    expect(result).toMatchObject({ state: "failed", coverage: 90, duplication: 1.25 });
    expect(result.failures).toContain("main_server_tests: failure");
    expect(JSON.stringify(result)).not.toContain("must-never-appear");
  });

  it("does not turn missing or malformed reports into zero findings or perfect coverage", () => {
    const partial: Record<string, unknown> = reports();
    delete partial["quality/ruff.sarif"];
    partial["python/coverage.json"] = { totals: { covered_lines: 100, num_statements: 10 } };
    partial["runtime/trivy-bot.json"] = { error: "must-never-appear" };
    const result = analyzeMainReports(sha, {}, partial);
    expect(result).toMatchObject({ state: "failed", duplication: 1.25, cyclomaticComplexity: 7 });
    expect(result.issueCount).toBeUndefined();
    expect(result.cognitiveComplexity).toEqual({ maximum: 12, exact: true });
    expect(result.coverage).toBeUndefined();
    expect(result.securityCount).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("must-never-appear");
  });

  it("counts the same actionable security finding once across scanners", () => {
    const finding = {
      VulnerabilityID: "CVE-SHARED",
      PkgName: "shared",
      Severity: "HIGH",
      FixedVersion: "2.0.0",
    };
    const input = {
      ...reports(),
      "runtime/trivy-bot.json": { Results: [{ Vulnerabilities: [finding] }] },
      "runtime/trivy-dashboard.json": { Results: [{ Vulnerabilities: [finding] }] },
    };
    expect(analyzeMainReports(sha, {}, input).securityCount).toBe(1);
  });

  it("retains independent source metrics when another source measure is invalid", () => {
    const input = {
      ...reports(),
      "quality/source-quality.json": {
        ...reports()["quality/source-quality.json"],
        repositoryDuplication: -1,
      },
    };
    expect(analyzeMainReports(sha, {}, input)).toMatchObject({
      state: "failed",
      moduleCount: 2,
      oversizedModuleCount: 1,
      cyclomaticComplexity: 7,
    });
    expect(analyzeMainReports(sha, {}, input).duplication).toBeUndefined();
  });

  it("reads cognitive complexity without requiring the unrelated Ruff report", () => {
    const input: Record<string, unknown> = reports();
    delete input["quality/ruff.sarif"];
    input["quality/source-quality.json"] = {
      ...reports()["quality/source-quality.json"],
      cognitiveComplexity: {
        repository: { maximum: 21, exact: true },
        newCode: { maximum: 0, exact: true },
      },
    };
    const result = analyzeMainReports(sha, {}, input);
    expect(result.issueCount).toBeUndefined();
    expect(result.cognitiveComplexity).toEqual({ maximum: 21, exact: true });
  });

  it("does not invent cognitive measurements when a cognitive scanner is missing", () => {
    const input: Record<string, unknown> = reports();
    input["quality/source-quality.json"] = {
      ...reports()["quality/source-quality.json"],
      cognitiveComplexity: undefined,
    };
    expect(analyzeMainReports(sha, {}, input).cognitiveComplexity).toBeUndefined();
    expect(analyzeMainReports(sha, {}, {}).moduleCount).toBeUndefined();
  });

  it("retains the upper bound and rejects invalid cognitive measurements", () => {
    const source = reports()["quality/source-quality.json"];
    const input = {
      ...reports(),
      "quality/source-quality.json": {
        ...source,
        cognitiveComplexity: {
          repository: { maximum: 1, exact: false },
          newCode: { maximum: 0, exact: true },
        },
      },
    };
    expect(analyzeMainReports(sha, {}, input).cognitiveComplexity).toEqual({
      maximum: 1,
      exact: false,
    });
    expect(
      analyzeMainReports(
        sha,
        {},
        {
          ...input,
          "quality/source-quality.json": {
            ...source,
            cognitiveComplexity: {
              repository: { maximum: 12, exact: false },
              newCode: { maximum: 0, exact: true },
            },
          },
        },
      ).cognitiveComplexity,
    ).toBeUndefined();
  });

  it("reports unavailable or skipped step metadata without exposing arbitrary values", () => {
    expect(analyzeMainReports(sha, null, reports()).state).toBe("failed");
    const result = analyzeMainReports(
      sha,
      {
        main_checkout: { outcome: "skipped" },
        main_tools: { outcome: "must-never-appear" },
        token: "must-never-appear",
      },
      reports(),
    );
    expect(result.failures).toContain("main_checkout: skipped");
    expect(result.failures).toContain("main_tools: unavailable");
    expect(JSON.stringify(result)).not.toContain("must-never-appear");
  });

  it("reports an unavailable reference without borrowing metrics from the PR", () => {
    const result = analyzeMainReports("", {}, reports());
    expect(result.state).toBe("unavailable");
    expect(result.commitSha).toBeUndefined();
    expect(result.coverage).toBeUndefined();
  });

  it("loads reports independently and keeps valid metrics after invalid JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-main-comparison-"));
    try {
      await mkdir(join(directory, "quality"));
      await writeFile(
        join(directory, "quality", "source-quality.json"),
        JSON.stringify(reports()["quality/source-quality.json"]),
      );
      await writeFile(join(directory, "quality", "biome.sarif"), "{invalid");
      expect(await loadMainComparison(directory, sha, "{}")).toMatchObject({
        state: "failed",
        duplication: 1.25,
        moduleCount: 2,
      });
      expect((await loadMainComparison(directory, sha, "{invalid")).failures).toContain(
        "Main analysis step results unavailable.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
