import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";
import { type CognitiveMeasurement, cognitiveMeasurementSchema } from "./cognitive-complexity.js";

import {
  DEFAULT_GATE_CONFIG,
  isActionableSecurityFinding,
  securityFindingFingerprint,
} from "./quality-gate.js";
import {
  aggregateRepositoryCoverage,
  parseNpmAuditReport,
  parsePipAuditReport,
  parseSarifReport,
  parseTrivyReport,
} from "./quality-gate-inputs.js";

export interface MainComparison {
  readonly commitSha?: string;
  readonly state: "success" | "failed" | "unavailable";
  readonly failures: readonly string[];
  readonly issueCount?: number;
  readonly securityCount?: number;
  readonly coverage?: number;
  readonly duplication?: number;
  readonly cyclomaticComplexity?: number;
  readonly cognitiveComplexity?: CognitiveMeasurement;
  readonly oversizedModuleCount?: number;
  readonly moduleCount?: number;
}

const mainCheckIds = [
  "main_reference",
  "main_checkout",
  "main_python",
  "main_tools",
  "main_quality",
  "main_source",
  "main_reports",
  "main_buildx",
  "main_database_cleanup",
  "main_node_image",
  "main_python_image",
  "main_database",
  "main_server_tests",
  "main_web_tests",
  "main_python_tests",
  "main_npm_audit",
  "main_pip_audit",
  "main_filesystem_scan",
  "main_bot_image",
  "main_dashboard_image",
  "main_transcription_image",
  "main_bot_scan",
  "main_dashboard_scan",
  "main_transcription_scan",
] as const;

const qualityReports = [
  "quality/biome.sarif",
  "quality/ruff.sarif",
  "quality/complexipy.sarif",
] as const;
const coverageReports = [
  "server/coverage/coverage-summary.json",
  "web/coverage/coverage-summary.json",
  "python/coverage.json",
] as const;
const trivyReports = [
  "security/trivy-filesystem.json",
  "runtime/trivy-bot.json",
  "runtime/trivy-dashboard.json",
  "runtime/trivy-faster-whisper.json",
] as const;
const reportPaths = [
  ...qualityReports,
  ...coverageReports,
  ...trivyReports,
  "security/npm-audit.json",
  "security/pip-audit.json",
  "quality/source-quality.json",
] as const;

const count = z.number().int().nonnegative();
const sarifSchema = z.object({
  runs: z.array(z.object({ results: z.array(z.record(z.string(), z.unknown())).optional() })),
});
const trivySchema = z.object({ Results: z.array(z.record(z.string(), z.unknown())) });
const npmSchema = z.object({
  vulnerabilities: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const pipSchema = z.object({ dependencies: z.array(z.record(z.string(), z.unknown())) });
const lineCountsSchema = z
  .object({ covered: count, total: count })
  .refine((value) => value.covered <= value.total);
const istanbulSchema = z.object({ total: z.object({ lines: lineCountsSchema }) });
const pythonCoverageSchema = z
  .object({ totals: z.object({ covered_lines: count, num_statements: count }) })
  .refine((value) => value.totals.covered_lines <= value.totals.num_statements);
const moduleSizesSchema = z.array(z.object({ sloc: count }));

const validatedReport = <T>(
  reports: Readonly<Record<string, unknown>>,
  path: string,
  schema: z.ZodType<T>,
  failures: string[],
): T | undefined => {
  const parsed = schema.safeParse(reports[path]);
  if (parsed.success) return parsed.data;
  failures.push(`Main report unavailable: ${path}`);
  return undefined;
};

const analysisFailures = (steps: unknown): string[] => {
  const parsed = z.record(z.string(), z.unknown()).safeParse(steps);
  if (!parsed.success) return ["Main analysis step results unavailable."];
  const failures: string[] = [];
  for (const id of mainCheckIds) {
    const step = parsed.data[id];
    if (step === undefined) continue;
    const outcome = z
      .object({ outcome: z.enum(["success", "failure", "cancelled", "skipped"]) })
      .safeParse(step);
    if (!outcome.success) failures.push(`${id}: unavailable`);
    else if (outcome.data.outcome !== "success") failures.push(`${id}: ${outcome.data.outcome}`);
  }
  return failures;
};

const qualityMetrics = (
  reports: Readonly<Record<string, unknown>>,
  failures: string[],
): Partial<MainComparison> => {
  const parsed = qualityReports.map((path) =>
    validatedReport(reports, path, sarifSchema, failures),
  );
  const issues = parsed.flatMap((report, index) =>
    parseSarifReport(report, qualityReports[index] ?? "quality"),
  );
  return {
    ...(parsed.every((report) => report !== undefined) ? { issueCount: issues.length } : {}),
  };
};

const securityMetrics = (
  reports: Readonly<Record<string, unknown>>,
  failures: string[],
): Partial<MainComparison> => {
  const npm = validatedReport(reports, "security/npm-audit.json", npmSchema, failures);
  const pip = validatedReport(reports, "security/pip-audit.json", pipSchema, failures);
  const trivy = trivyReports.map((path) => validatedReport(reports, path, trivySchema, failures));
  if (!npm || !pip || trivy.some((report) => report === undefined)) return {};
  const findings = [
    ...parseNpmAuditReport(npm),
    ...parsePipAuditReport(pip),
    ...trivy.flatMap((report) => parseTrivyReport(report).vulnerabilities),
  ];
  return {
    securityCount: new Set(
      findings.filter(isActionableSecurityFinding).map(securityFindingFingerprint),
    ).size,
  };
};

const coverageMetrics = (
  reports: Readonly<Record<string, unknown>>,
  failures: string[],
): Partial<MainComparison> => {
  const server = validatedReport(reports, coverageReports[0], istanbulSchema, failures);
  const web = validatedReport(reports, coverageReports[1], istanbulSchema, failures);
  const python = validatedReport(reports, coverageReports[2], pythonCoverageSchema, failures);
  if (!server || !web || !python) return {};
  return { coverage: aggregateRepositoryCoverage([server, web, python]).percentage };
};

const sourceMetrics = (
  reports: Readonly<Record<string, unknown>>,
  failures: string[],
): Partial<MainComparison> => {
  const source = validatedReport(
    reports,
    "quality/source-quality.json",
    z.record(z.string(), z.unknown()),
    failures,
  );
  if (!source) return {};
  const duplication = validatedReport(
    source,
    "repositoryDuplication",
    z.number().min(0).max(100),
    failures,
  );
  const complexity = validatedReport(source, "repositoryMaxComplexity", count, failures);
  const modules = validatedReport(source, "modules", moduleSizesSchema, failures);
  const cognitive = validatedReport(
    source,
    "cognitiveComplexity",
    z.object({ repository: cognitiveMeasurementSchema }),
    failures,
  );
  return {
    ...(cognitive ? { cognitiveComplexity: cognitive.repository } : {}),
    ...(duplication !== undefined ? { duplication } : {}),
    ...(complexity !== undefined ? { cyclomaticComplexity: complexity } : {}),
    ...(modules !== undefined
      ? {
          oversizedModuleCount: modules.filter(
            (module) => module.sloc > DEFAULT_GATE_CONFIG.moduleSlocMaximum,
          ).length,
          moduleCount: modules.length,
        }
      : {}),
  };
};

export const analyzeMainReports = (
  commitSha: unknown,
  steps: unknown,
  reports: Readonly<Record<string, unknown>>,
): MainComparison => {
  const sha = z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .safeParse(commitSha);
  if (!sha.success)
    return { state: "unavailable", failures: ["Current main revision unavailable."] };
  const failures = analysisFailures(steps);
  const metrics = {
    ...qualityMetrics(reports, failures),
    ...securityMetrics(reports, failures),
    ...coverageMetrics(reports, failures),
    ...sourceMetrics(reports, failures),
  };
  return {
    ...metrics,
    commitSha: sha.data,
    state: failures.length === 0 ? "success" : "failed",
    failures,
  };
};

export const loadMainComparisonFiles = async (
  files: readonly string[],
  commitSha: unknown,
  stepsJson: string,
): Promise<MainComparison> => {
  const reports: Record<string, unknown> = {};
  for (const path of reportPaths) {
    const suffix = /^(?:quality|security|runtime)\//u.test(path)
      ? path.slice(path.indexOf("/") + 1)
      : path;
    const file = files.find((candidate) => candidate.replaceAll("\\", "/").endsWith(`/${suffix}`));
    if (!file) continue;
    try {
      reports[path] = JSON.parse(await readFile(file, "utf8"));
    } catch (error: unknown) {
      // Invalid or missing comparison reports are reported per metric; never expose their content.
      if (!(error instanceof SyntaxError) && !(error instanceof Error && "code" in error))
        throw error;
    }
  }
  let steps: unknown;
  try {
    steps = JSON.parse(stepsJson);
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    steps = undefined;
  }
  return analyzeMainReports(commitSha, steps, reports);
};

export const loadMainComparison = (
  directory: string,
  commitSha: unknown,
  stepsJson: string,
): Promise<MainComparison> =>
  loadMainComparisonFiles(
    reportPaths.map((path) => join(directory, path)),
    commitSha,
    stepsJson,
  );
