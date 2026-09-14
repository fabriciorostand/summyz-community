import { describe, expect, it } from "vitest";

import {
  evaluateQualityGate,
  type GateMetrics,
  renderQualityGateMarkdown,
  type SecurityFinding,
} from "../scripts/ci/quality-gate.js";

const metrics = (securityFindings: readonly SecurityFinding[]): GateMetrics => ({
  baseOversizedModuleCount: 0,
  baseRepositoryCoverage: 91.25,
  baseRepositoryDuplication: 0.5,
  baseRepositoryIssueCount: 0,
  baseRepositorySecurityCount: 0,
  changedOversizedModuleCount: 0,
  modules: [{ changed: false, path: "src/example.ts", sloc: 20 }],
  newCoverage: 90,
  newCoverageAvailable: true,
  newDuplication: 0,
  newMaxComplexity: 4,
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
    expect(markdown).toContain("| Measure | New code | Main in PR | Δ from main | Rule |");
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
});
