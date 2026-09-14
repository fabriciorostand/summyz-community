import { describe, expect, it } from "vitest";

import {
  aggregateDiffCoverage,
  aggregateRepositoryCoverage,
  parseNpmAuditReport,
  parsePipAuditReport,
  parseSarifReport,
  parseTrivyReport,
} from "../scripts/ci/quality-gate-inputs.js";

describe("Quality Gate report inputs", () => {
  it("does not report perfect coverage when coverage evidence is missing", () => {
    expect(aggregateDiffCoverage([])).toEqual({
      available: false,
      covered: 0,
      percentage: 0,
      total: 0,
    });
    expect(aggregateRepositoryCoverage([])).toEqual({
      available: false,
      covered: 0,
      percentage: 0,
      total: 0,
    });
  });

  it("aggregates new-code coverage across all components by executable line", () => {
    const result = aggregateDiffCoverage([
      { total_num_lines: 8, total_num_violations: 2 },
      { total_num_lines: 2, total_num_violations: 0 },
      { total_num_lines: 0, total_num_violations: 0 },
    ]);

    expect(result).toEqual({ available: true, covered: 8, percentage: 80, total: 10 });
  });

  it("aggregates repository coverage across server, dashboard, and Python", () => {
    const result = aggregateRepositoryCoverage([
      { total: { lines: { covered: 80, pct: 80, skipped: 0, total: 100 } } },
      { total: { lines: { covered: 18, pct: 90, skipped: 0, total: 20 } } },
      { totals: { covered_lines: 9, num_statements: 10 } },
    ]);

    expect(result).toEqual({ available: true, covered: 107, percentage: 82.31, total: 130 });
  });

  it("marks coverage as available only when all three component reports exist", () => {
    const reports = [
      { total_num_lines: 4, total_num_violations: 0 },
      { total_num_lines: 3, total_num_violations: 0 },
      { total_num_lines: 3, total_num_violations: 0 },
    ];

    expect(aggregateDiffCoverage(reports.slice(0, 2)).available).toBe(false);
    expect(aggregateDiffCoverage(reports).available).toBe(true);
  });

  it("keeps fixed and unfixed Trivy findings in the complete report", () => {
    const parsed = parseTrivyReport(
      {
        Results: [
          {
            Target: "debian",
            Vulnerabilities: [
              {
                Description: "A fixed vulnerability.",
                FixedVersion: "2.0.0",
                PkgName: "fixed-lib",
                PrimaryURL: "https://example.test/CVE-FIXED",
                Severity: "HIGH",
                VulnerabilityID: "CVE-FIXED",
              },
              {
                Description: "An unfixed vulnerability.",
                FixedVersion: "",
                PkgName: "unfixed-lib",
                Severity: "CRITICAL",
                VulnerabilityID: "CVE-UNFIXED",
              },
            ],
          },
        ],
      },
      { sourcePath: "Dockerfile" },
    );

    expect(parsed.vulnerabilities).toHaveLength(2);
    expect(parsed.vulnerabilities[0]?.fixedVersions).toEqual(["2.0.0"]);
    expect(parsed.vulnerabilities[1]?.fixedVersions).toEqual([]);
  });

  it("does not include a secret value in Trivy diagnostics", () => {
    const parsed = parseTrivyReport(
      {
        Results: [
          {
            Secrets: [
              {
                Category: "AWS",
                Match: "must-never-appear",
                RuleID: "aws-access-key-id",
                Severity: "CRITICAL",
                StartLine: 12,
                Title: "AWS access key",
              },
            ],
            Target: ".env.example",
          },
        ],
      },
      { sourcePath: ".env.example" },
    );

    expect(parsed.securityIssues[0]?.message).toBe("AWS access key");
    expect(JSON.stringify(parsed)).not.toContain("must-never-appear");
  });

  it("reads fix availability from npm and preserves pip findings without severity", () => {
    const npmFindings = parseNpmAuditReport({
      vulnerabilities: {
        example: {
          fixAvailable: { name: "example", version: "4.0.0" },
          name: "example",
          severity: "high",
          via: [
            {
              severity: "high",
              source: 123,
              title: "Example advisory",
              url: "https://example.test/123",
            },
          ],
        },
      },
    });
    const pipFindings = parsePipAuditReport({
      dependencies: [
        {
          name: "python-example",
          version: "1.0.0",
          vulns: [
            {
              description: "Python advisory",
              fix_versions: [],
              id: "PYSEC-1",
            },
          ],
        },
      ],
    });

    expect(npmFindings[0]?.fixedVersions).toEqual(["4.0.0"]);
    expect(npmFindings[0]?.severity).toBe("HIGH");
    expect(pipFindings[0]?.fixedVersions).toEqual([]);
    expect(pipFindings[0]?.severity).toBe("UNKNOWN");
  });

  it("normalizes SARIF diagnostics from quality and security scanners", () => {
    const diagnostics = parseSarifReport(
      {
        runs: [
          {
            results: [
              {
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: "src/example.ts" },
                      region: { startLine: 9 },
                    },
                  },
                ],
                message: { text: "Avoid the example." },
                ruleId: "lint/example",
              },
            ],
            tool: {
              driver: {
                name: "Biome",
                rules: [
                  {
                    helpUri: "https://example.test/rule",
                    id: "lint/example",
                  },
                ],
              },
            },
          },
        ],
      },
      "biome",
    );

    expect(diagnostics).toEqual([
      {
        detailsUrl: "https://example.test/rule",
        line: 9,
        message: "Avoid the example.",
        path: "src/example.ts",
        rule: "lint/example",
        tool: "biome",
      },
    ]);
  });
});
