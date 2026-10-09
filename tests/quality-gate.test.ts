import { describe, expect, it } from "vitest";

import {
  evaluateQualityGate,
  type GateMetrics,
  renderQualityGateMarkdown,
  type SecurityFinding,
  securityFindingFingerprint,
} from "../scripts/ci/quality-gate.js";

const metrics = (securityFindings: readonly SecurityFinding[]): GateMetrics => ({
  changedOversizedModuleCount: 0,
  modules: [{ changed: false, path: "src/example.ts", sloc: 20 }],
  newCoverage: 90,
  newCoverageAvailable: true,
  newDuplication: 0,
  newMaxComplexity: 4,
  newCognitiveComplexity: { maximum: 0, exact: true },
  newComplexityViolations: 0,
  newIssues: [],
  repositoryCoverage: 92,
  repositoryCoverageAvailable: true,
  repositoryDuplication: 0.4,
  repositoryIssues: [],
  repositoryMaxComplexity: 4,
  securityFindings,
  jobResults: {
    quality: "success",
    runtime: "success",
    security: "success",
    tests: "success",
  },
});

describe("Quality Gate", () => {
  it("counts and blocks only fixable HIGH/CRITICAL vulnerabilities", () => {
    const findings: readonly SecurityFinding[] = [
      {
        fixedVersions: [],
        id: "CVE-UNFIXED",
        line: 1,
        message: "No fix has been published.",
        packageName: "lib-unfixed",
        path: "Dockerfile",
        severity: "CRITICAL",
        tool: "trivy",
      },
      {
        fixedVersions: ["2.0.0"],
        id: "CVE-MEDIUM",
        line: 1,
        message: "A medium-severity update is available.",
        packageName: "lib-medium",
        path: "package-lock.json",
        severity: "MEDIUM",
        tool: "npm-audit",
      },
      {
        fixedVersions: ["3.0.0"],
        id: "CVE-ACTIONABLE",
        line: 1,
        message: "Upgrade to 3.0.0.",
        packageName: "lib-actionable",
        path: "services/faster-whisper/requirements.lock",
        severity: "HIGH",
        tool: "trivy",
      },
    ];

    const result = evaluateQualityGate(metrics(findings));

    expect(result.metrics.repositorySecurity).toHaveLength(1);
    expect(result.metrics.repositorySecurity[0]?.id).toBe("CVE-ACTIONABLE");
    expect(result.passed).toBe(false);
  });

  it("counts one vulnerability reported by multiple scanners only once", () => {
    const shared = {
      fixedVersions: ["3.0.0"],
      id: "CVE-SHARED",
      line: 1,
      message: "Upgrade to 3.0.0.",
      packageName: "shared-package",
      severity: "CRITICAL",
    } as const;

    const result = evaluateQualityGate(
      metrics([
        { ...shared, path: "package-lock.json", tool: "npm-audit" },
        { ...shared, path: "Dockerfile", tool: "trivy" },
      ]),
    );

    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "0123456789abcdef",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });

    expect(result.metrics.repositorySecurity).toHaveLength(1);
    expect(markdown.match(/`CVE-SHARED`/gu)).toHaveLength(1);
  });

  it("does not grandfather existing functions above the complexity limit", () => {
    const result = evaluateQualityGate({ ...metrics([]), repositoryMaxComplexity: 11 });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      "Repository maximum cyclomatic complexity 11 exceeds the configured limit of 10.",
    );
  });

  it("fails when new code exceeds the cognitive complexity limit", () => {
    const result = evaluateQualityGate({
      ...metrics([]),
      newIssues: [
        {
          line: 22,
          message: "Excessive complexity of 18 detected (max: 15).",
          path: "web/src/pages/tasks-page.tsx",
          rule: "lint/complexity/noExcessiveCognitiveComplexity",
          tool: "biome",
        },
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      "New code introduces 1 function(s) above cognitive complexity 15.",
    );
  });

  it("reads the cognitive complexity reported by complexipy for Python", () => {
    const result = evaluateQualityGate({
      ...metrics([]),
      newIssues: [
        {
          line: 10,
          message:
            "Function 'run' has a cognitive complexity of 21, which exceeds the maximum allowed complexity of 15.",
          path: "services/faster-whisper/server.py",
          rule: "CC001",
          tool: "complexipy",
        },
      ],
    });

    expect(result.failures).toContain(
      "New code introduces 1 function(s) above cognitive complexity 15.",
    );
  });

  it("reports cyclomatic and cognitive complexity as separate measures", () => {
    const result = evaluateQualityGate({
      ...metrics([]),
      repositoryIssues: [
        {
          line: 1,
          message: "Excessive complexity of 43 detected (max: 15).",
          path: "src/legacy.ts",
          rule: "lint/complexity/noExcessiveCognitiveComplexity",
          tool: "biome",
        },
      ],
    });
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "0123456789abcdef",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });

    expect(markdown).toContain("Cyclomatic complexity");
    expect(markdown).toContain("Cognitive complexity");
    expect(markdown).not.toContain("Maximum complexity");
    expect(markdown).toContain("| Cognitive complexity |");
    expect(markdown).toContain("43");
  });

  it("passes when every function stays within both complexity limits", () => {
    const result = evaluateQualityGate(metrics([]));

    expect(result.failures.filter((failure) => failure.includes("complexity"))).toHaveLength(0);
  });

  it("fails closed and reports unavailable coverage when required evidence is missing", () => {
    const result = evaluateQualityGate({
      ...metrics([]),
      newCoverage: 0,
      newCoverageAvailable: false,
      repositoryCoverage: 94.85,
      repositoryCoverageAvailable: false,
    });
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "0123456789abcdef",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });

    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      "New-code coverage is unavailable because required coverage reports are missing.",
    );
    expect(result.failures).toContain(
      "Repository coverage is unavailable because required coverage reports are missing.",
    );
    const coverageRow = markdown.split("\n").find((line) => line.startsWith("| Coverage |"));
    expect(coverageRow).toContain("unavailable");
    expect(coverageRow).not.toContain("0.00%");
    expect(coverageRow).not.toContain("94.85%");
  });

  it("passes with a green zero when all vulnerabilities are unfixable", () => {
    const unfixable: SecurityFinding = {
      fixedVersions: [],
      id: "CVE-UNFIXED",
      line: 7,
      message: "No fix has been published.",
      packageName: "lib-unfixed",
      path: "Dockerfile",
      severity: "CRITICAL",
      tool: "trivy",
    };
    const result = evaluateQualityGate(metrics([unfixable]));
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "0123456789abcdef",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });

    expect(result.passed).toBe(true);
    expect(result.metrics.repositorySecurity).toEqual([]);
    expect(markdown).toContain("## ✅ Quality Gate passed");
    expect(markdown).toContain("| Measure | New code | Main | Δ from main | Rule |");
    expect(markdown).toContain("| Security |");
    expect(markdown).toContain(">HIGH/CRITICAL</a>");
    expect(markdown).toContain("<summary>Issue details</summary>");
    expect(markdown).toContain("`CVE-UNFIXED`: No fix has been published.");
    expect(markdown).not.toContain("Runtime / Images");
    expect(markdown).not.toContain("| Tests |");
    expect(markdown).not.toMatch(/Segurança|Cobertura|Detalhes|passou|falhou/u);
  });

  it("escapes scanner-controlled content in the Markdown report", () => {
    const result = evaluateQualityGate(
      metrics([
        {
          fixedVersions: [],
          id: "CVE-1",
          line: 1,
          message: "<script>alert(1)</script>",
          packageName: "unsafe",
          path: "image<name>",
          severity: "LOW",
          tool: "trivy",
        },
      ]),
    );

    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "0123456789abcdef",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });

    expect(markdown).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markdown).not.toContain("<script>");
  });

  it("renders main metrics and numerical deltas without changing gate approval", () => {
    const result = evaluateQualityGate(metrics([]));
    const context = {
      commitSha: "b".repeat(40),
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
      mainComparison: {
        commitSha: "a".repeat(40),
        state: "failed" as const,
        failures: ["main_server_tests: failure"],
        issueCount: 2,
        securityCount: 1,
        coverage: 88,
        duplication: 1.4,
        cyclomaticComplexity: 7,
        cognitiveComplexity: { maximum: 18, exact: true },
        oversizedModuleCount: 2,
        moduleCount: 100,
      },
    };
    const markdown = renderQualityGateMarkdown(result, context);
    const row = (name: string) =>
      markdown.split("\n").find((line) => line.startsWith(`| ${name} |`));
    expect(row("Issues")).toContain(">2</a>");
    expect(row("Issues")).toContain(">-2</a>");
    expect(row("Coverage")).toContain(">88.00%</a>");
    expect(row("Coverage")).toContain(">+2.00 pp</a>");
    expect(row("Duplication")).toContain(">-1.40 pp</a>");
    expect(row("Cyclomatic complexity")).toContain(">-3</a>");
    expect(row("Cognitive complexity")).toContain(">-18</a>");
    expect(row("Modules over 500 SLOC")).toContain(">2 of 100</a>");
    expect(markdown).toContain("Main analysis failed");
    expect(markdown).toContain("a".repeat(40));
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("shows hyphens for unavailable main metrics and their deltas", () => {
    const markdown = renderQualityGateMarkdown(evaluateQualityGate(metrics([])), {
      commitSha: "b".repeat(40),
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
    });
    const rows = markdown
      .split("\n")
      .filter((line) => line.startsWith("| "))
      .slice(1);
    for (const row of rows) expect(row).toContain(">-</a> | <a");
    expect(markdown).toContain("Main analysis unavailable");
    expect(markdown).not.toContain("Main in PR");
  });

  it("omits the successful main analysis notice while retaining its metrics", () => {
    const markdown = renderQualityGateMarkdown(evaluateQualityGate(metrics([])), {
      commitSha: "b".repeat(40),
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
      mainComparison: {
        commitSha: "a".repeat(40),
        state: "success",
        failures: [],
        coverage: 88,
      },
    });
    expect(markdown).not.toContain("Main analysis success");
    expect(markdown).not.toContain(`/commit/${"a".repeat(40)}`);
    expect(markdown).toContain(">88.00%</a>");
    expect(markdown).toContain(">+2.00 pp</a>");
  });

  it("subtracts main from displayed new-code metrics even when repository metrics differ", () => {
    const existingSecurity: SecurityFinding = {
      fixedVersions: ["2.0.0"],
      id: "CVE-EXISTING",
      line: 1,
      message: "Upgrade dependency.",
      packageName: "dependency",
      path: "package-lock.json",
      severity: "HIGH",
      tool: "npm-audit",
    };
    const result = evaluateQualityGate({
      ...metrics([existingSecurity]),
      baseSecurityFingerprints: [securityFindingFingerprint(existingSecurity)],
      modules: [{ changed: false, path: "src/existing.ts", sloc: 501 }],
      repositoryIssues: [
        {
          line: 1,
          message: "Excessive complexity of 18 detected (max: 15).",
          path: "src/existing.ts",
          rule: "lint/complexity/noExcessiveCognitiveComplexity",
          tool: "biome",
        },
      ],
      repositoryMaxComplexity: 9,
    });
    const failures = [...result.failures];
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "b".repeat(40),
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      repository: "example/summyz",
      mainComparison: {
        state: "success",
        failures: [],
        issueCount: 1,
        securityCount: 1,
        coverage: 92,
        duplication: 0.4,
        cyclomaticComplexity: 9,
        cognitiveComplexity: { maximum: 18, exact: true },
        oversizedModuleCount: 1,
        moduleCount: 1,
      },
    });
    const expected = {
      Issues: "-1",
      Security: "-1",
      Coverage: "-2.00 pp",
      Duplication: "-0.40 pp",
      "Cyclomatic complexity": "-5",
      "Cognitive complexity": "-18",
      "Modules over 500 SLOC": "-1",
    };
    for (const [name, value] of Object.entries(expected)) {
      const row = markdown.split("\n").find((line) => line.startsWith(`| ${name} |`));
      expect(row).toContain(`>${value}</a>`);
    }
    expect(result.failures).toEqual(failures);
    expect(result.passed).toBe(false);
  });

  it.each([
    [{ maximum: 1, exact: false }, { maximum: 15, exact: true }, "[-15, -14]"],
    [{ maximum: 5, exact: true }, { maximum: 1, exact: false }, "[+4, +5]"],
    [{ maximum: 1, exact: false }, { maximum: 1, exact: false }, "[-1, +1]"],
    [{ maximum: 0, exact: true }, { maximum: 15, exact: true }, "-15"],
  ])("renders cognitive maxima and the possible delta interval", (newCode, main, expected) => {
    const result = evaluateQualityGate({ ...metrics([]), newCognitiveComplexity: newCode });
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "b".repeat(40),
      repository: "example/summyz",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      mainComparison: { state: "success", failures: [], cognitiveComplexity: main },
    });
    const row = markdown.split("\n").find((line) => line.startsWith("| Cognitive complexity |"));
    expect(row).toContain(`>${expected}</a>`);
    if (!newCode.exact || !main.exact) expect(row).toContain("≤ 1");
    expect(result.passed).toBe(true);
  });

  it("shows unavailable cognitive metrics without inventing zero or changing approval", () => {
    const { newCognitiveComplexity: _measurement, ...values } = metrics([]);
    const result = evaluateQualityGate(values);
    const markdown = renderQualityGateMarkdown(result, {
      commitSha: "b".repeat(40),
      repository: "example/summyz",
      detailsUrl: "https://github.com/example/summyz/actions/runs/1",
      mainComparison: {
        state: "success",
        failures: [],
        cognitiveComplexity: { maximum: 15, exact: true },
      },
    });
    const row = markdown.split("\n").find((line) => line.startsWith("| Cognitive complexity |"));
    expect(row).toContain("&nbsp;-</a>");
    expect(row).toContain(">-</a>");
    expect(row).not.toContain("&nbsp;0</a>");
    expect(result.passed).toBe(true);
  });
});
