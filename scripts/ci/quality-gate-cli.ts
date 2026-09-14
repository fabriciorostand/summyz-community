import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { z } from "zod";
import {
  type Diagnostic,
  diagnosticFingerprint,
  evaluateQualityGate,
  type GateMetrics,
  renderQualityGateMarkdown,
  type SecurityFinding,
  securityFindingFingerprint,
} from "./quality-gate.js";
import {
  aggregateDiffCoverage,
  aggregateRepositoryCoverage,
  parseNpmAuditReport,
  parsePipAuditReport,
  parseSarifReport,
  parseTrivyReport,
} from "./quality-gate-inputs.js";

const moduleSchema = z.object({
  changed: z.boolean(),
  path: z.string(),
  sloc: z.number().int().nonnegative(),
});
const duplicateLocationSchema = z.object({
  end: z.number().int().positive(),
  path: z.string(),
  start: z.number().int().positive(),
});
const sourceQualitySchema = z.object({
  changedOversizedModuleCount: z.number().int().nonnegative(),
  complexityFindings: z.array(
    z.object({
      complexity: z.number().int().nonnegative(),
      line: z.number().int().positive(),
      name: z.string(),
      path: z.string(),
    }),
  ),
  duplicateGroups: z.array(
    z.object({
      lines: z.number().int().positive(),
      locations: z.array(duplicateLocationSchema),
    }),
  ),
  modules: z.array(moduleSchema),
  newComplexityViolations: z.number().int().nonnegative(),
  newDuplication: z.number().nonnegative(),
  newMaxComplexity: z.number().int().nonnegative(),
  repositoryDuplication: z.number().nonnegative(),
  repositoryMaxComplexity: z.number().int().nonnegative(),
});
const baselineSchema = z.object({
  oversizedModuleCount: z.number().int().nonnegative(),
  repositoryCoverage: z.number().nonnegative(),
  repositoryDuplication: z.number().nonnegative(),
  repositoryIssueFingerprints: z.array(z.string()),
  repositorySecurityCount: z.number().int().nonnegative(),
  securityFingerprints: z.array(z.string()),
  version: z.literal(1),
});

type Baseline = z.infer<typeof baselineSchema>;

interface LocatedJson {
  readonly path: string;
  readonly value: unknown;
}

const listFiles = async (directory: string): Promise<readonly string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await listFiles(path)));
      else if (entry.isFile()) files.push(path);
    }
    return files;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
};

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const findJson = async (
  files: readonly string[],
  predicate: (path: string) => boolean,
): Promise<LocatedJson | undefined> => {
  const path = files.find(predicate);
  return path ? { path, value: await readJson(path) } : undefined;
};

const allJson = async (
  files: readonly string[],
  predicate: (path: string) => boolean,
): Promise<readonly LocatedJson[]> =>
  Promise.all(files.filter(predicate).map(async (path) => ({ path, value: await readJson(path) })));

const pathEndsWith = (path: string, suffix: string): boolean =>
  path.replaceAll("\\", "/").endsWith(suffix);

const parseQualityIssues = async (files: readonly string[]): Promise<readonly Diagnostic[]> => {
  const tools = ["biome", "ruff", "complexipy"] as const;
  const toolFor = (path: string): string =>
    tools.find((tool) => pathEndsWith(path, `/${tool}.sarif`)) ?? "biome";
  const reports = await allJson(files, (path) =>
    tools.some((tool) => pathEndsWith(path, `/${tool}.sarif`)),
  );
  return reports.flatMap((report) => parseSarifReport(report.value, toolFor(report.path)));
};

const trivySourcePath = (path: string): string | undefined => {
  if (pathEndsWith(path, "/trivy-bot.json")) return "Dockerfile";
  if (pathEndsWith(path, "/trivy-dashboard.json")) return "Dockerfile";
  if (pathEndsWith(path, "/trivy-faster-whisper.json")) {
    return "services/faster-whisper/Dockerfile";
  }
  return undefined;
};

const parseSecurityReports = async (
  files: readonly string[],
): Promise<{
  readonly findings: readonly SecurityFinding[];
  readonly issues: readonly Diagnostic[];
}> => {
  const findings: SecurityFinding[] = [];
  const issues: Diagnostic[] = [];
  const npm = await findJson(files, (path) => pathEndsWith(path, "/npm-audit.json"));
  if (npm) findings.push(...parseNpmAuditReport(npm.value));
  const pip = await findJson(files, (path) => pathEndsWith(path, "/pip-audit.json"));
  if (pip) findings.push(...parsePipAuditReport(pip.value));
  const trivyReports = await allJson(files, (path) =>
    /\/trivy-[^/]+\.json$/u.test(path.replaceAll("\\", "/")),
  );
  for (const report of trivyReports) {
    const sourcePath = trivySourcePath(report.path);
    const parsed = parseTrivyReport(report.value, sourcePath ? { sourcePath } : {});
    findings.push(...parsed.vulnerabilities);
    issues.push(...parsed.securityIssues);
  }
  const sarifReports = await allJson(
    files,
    (path) =>
      pathEndsWith(path, "/gitleaks.sarif") ||
      pathEndsWith(path, "/zizmor.sarif") ||
      pathEndsWith(path, "/trivy-policy.sarif"),
  );
  for (const report of sarifReports) {
    const filename = report.path.replaceAll("\\", "/").split("/").at(-1) ?? "security";
    issues.push(...parseSarifReport(report.value, filename.replace(/\.sarif$/u, "")));
  }
  return { findings, issues };
};

const loadBaseline = async (baselineDirectory: string): Promise<Baseline | undefined> => {
  const files = await listFiles(baselineDirectory);
  const baselinePath = files.find((path) => pathEndsWith(path, "/quality-gate-baseline.json"));
  if (!baselinePath) return undefined;
  return baselineSchema.parse(await readJson(baselinePath));
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
};

const main = async (): Promise<void> => {
  const [
    reportsArgument = "reports",
    baselineArgument = "baseline",
    outputArgument = "ci-summary.md",
  ] = process.argv.slice(2);
  const reportsDirectory = resolve(reportsArgument);
  const files = await listFiles(reportsDirectory);
  const baseline = await loadBaseline(resolve(baselineArgument));

  const coverageReports = await allJson(
    files,
    (path) =>
      pathEndsWith(path, "/server/coverage/coverage-summary.json") ||
      pathEndsWith(path, "/web/coverage/coverage-summary.json") ||
      pathEndsWith(path, "/python/coverage.json"),
  );
  const repositoryCoverage = aggregateRepositoryCoverage(
    coverageReports.map((report) => report.value),
  );
  const diffReports = await allJson(files, (path) =>
    /\/diff-coverage\/(?:server|web|python)\.json$/u.test(path.replaceAll("\\", "/")),
  );
  const newCoverage = aggregateDiffCoverage(diffReports.map((report) => report.value));
  const sourceReport = await findJson(files, (path) => pathEndsWith(path, "/source-quality.json"));
  const source = sourceReport
    ? sourceQualitySchema.parse(sourceReport.value)
    : sourceQualitySchema.parse({
        changedOversizedModuleCount: 0,
        complexityFindings: [],
        duplicateGroups: [],
        modules: [],
        newComplexityViolations: 0,
        newDuplication: 0,
        newMaxComplexity: 0,
        repositoryDuplication: 0,
        repositoryMaxComplexity: 0,
      });
  const repositoryIssues = await parseQualityIssues(files);
  const baseIssueFingerprints = new Set(baseline?.repositoryIssueFingerprints ?? []);
  const newIssues = repositoryIssues.filter(
    (diagnostic) => !baseIssueFingerprints.has(diagnosticFingerprint(diagnostic)),
  );
  const security = await parseSecurityReports(files);

  const metrics: GateMetrics = {
    ...(baseline
      ? {
          baseOversizedModuleCount: baseline.oversizedModuleCount,
          baseRepositoryCoverage: baseline.repositoryCoverage,
          baseRepositoryDuplication: baseline.repositoryDuplication,
          baseRepositoryIssueCount: baseline.repositoryIssueFingerprints.length,
          baseRepositorySecurityCount: baseline.repositorySecurityCount,
          baseSecurityFingerprints: baseline.securityFingerprints,
        }
      : {}),
    changedOversizedModuleCount: source.changedOversizedModuleCount,
    complexityFindings: source.complexityFindings,
    duplicateGroups: source.duplicateGroups,
    jobResults: {
      quality: requiredEnvironment("QUALITY_RESULT"),
      runtime: requiredEnvironment("RUNTIME_RESULT"),
      security: requiredEnvironment("SECURITY_RESULT"),
      tests: requiredEnvironment("TESTS_RESULT"),
    },
    modules: source.modules,
    newComplexityViolations: source.newComplexityViolations,
    newCoverage: newCoverage.percentage,
    newCoverageAvailable: newCoverage.available,
    newDuplication: source.newDuplication,
    newIssues,
    newMaxComplexity: source.newMaxComplexity,
    repositoryCoverage: repositoryCoverage.percentage,
    repositoryCoverageAvailable: repositoryCoverage.available,
    repositoryDuplication: source.repositoryDuplication,
    repositoryIssues,
    repositoryMaxComplexity: source.repositoryMaxComplexity,
    securityFindings: security.findings,
    securityIssues: security.issues,
  };
  const result = evaluateQualityGate(metrics);
  const markdown = renderQualityGateMarkdown(result, {
    commitSha: requiredEnvironment("GITHUB_SHA"),
    detailsUrl: requiredEnvironment("DETAILS_URL"),
    repository: requiredEnvironment("GITHUB_REPOSITORY"),
  });
  const outputPath = resolve(outputArgument);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  await writeFile(
    resolve(dirname(outputPath), "quality-gate-result.json"),
    `${JSON.stringify({ failures: result.failures, passed: result.passed }, null, 2)}\n`,
    "utf8",
  );
  const oversizedModuleCount = result.metrics.modules.filter(
    (module) => module.sloc > result.config.moduleSlocMaximum,
  ).length;
  const nextBaseline: Baseline = {
    oversizedModuleCount,
    repositoryCoverage: result.metrics.repositoryCoverage,
    repositoryDuplication: result.metrics.repositoryDuplication,
    repositoryIssueFingerprints: result.metrics.repositoryIssues.map(diagnosticFingerprint),
    repositorySecurityCount: result.metrics.repositorySecurity.length,
    securityFingerprints: result.metrics.repositorySecurity.map(securityFindingFingerprint),
    version: 1,
  };
  await writeFile(
    resolve(dirname(outputPath), "quality-gate-baseline.json"),
    `${JSON.stringify(nextBaseline, null, 2)}\n`,
    "utf8",
  );
};

await main();
