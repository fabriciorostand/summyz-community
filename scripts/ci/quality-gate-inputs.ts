import type { Diagnostic, SecurityFinding } from "./quality-gate.js";

type JsonRecord = Record<string, unknown>;

export interface CoverageAggregate {
  readonly covered: number;
  readonly percentage: number;
  readonly total: number;
}

export interface TrivyReportOptions {
  readonly sourcePath?: string;
}

export interface ParsedTrivyReport {
  readonly securityIssues: readonly Diagnostic[];
  readonly vulnerabilities: readonly SecurityFinding[];
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (record: JsonRecord, key: string, fallback = ""): string => {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
};

const numberValue = (record: JsonRecord, key: string, fallback = 0): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const recordArray = (record: JsonRecord, key: string): readonly JsonRecord[] => {
  const value = record[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
};

const roundPercentage = (covered: number, total: number): number =>
  total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100;

export const aggregateDiffCoverage = (reports: readonly unknown[]): CoverageAggregate => {
  let total = 0;
  let violations = 0;
  for (const report of reports) {
    if (!isRecord(report)) continue;
    total += numberValue(report, "total_num_lines");
    violations += numberValue(report, "total_num_violations");
  }
  const covered = Math.max(0, total - violations);
  return { covered, percentage: roundPercentage(covered, total), total };
};

const coverageCounts = (report: unknown): Pick<CoverageAggregate, "covered" | "total"> => {
  if (!isRecord(report)) return { covered: 0, total: 0 };
  const totalEntry = report.total;
  if (isRecord(totalEntry) && isRecord(totalEntry.lines)) {
    return {
      covered: numberValue(totalEntry.lines, "covered"),
      total: numberValue(totalEntry.lines, "total"),
    };
  }
  const totals = report.totals;
  if (isRecord(totals)) {
    return {
      covered: numberValue(totals, "covered_lines"),
      total: numberValue(totals, "num_statements"),
    };
  }
  return { covered: 0, total: 0 };
};

export const aggregateRepositoryCoverage = (reports: readonly unknown[]): CoverageAggregate => {
  let covered = 0;
  let total = 0;
  for (const report of reports) {
    const counts = coverageCounts(report);
    covered += counts.covered;
    total += counts.total;
  }
  return { covered, percentage: roundPercentage(covered, total), total };
};

const fixedVersions = (value: string): readonly string[] =>
  value
    .split(",")
    .map((version) => version.trim())
    .filter((version) => version.length > 0);

const trivyPath = (result: JsonRecord, options: TrivyReportOptions): string =>
  options.sourcePath ?? stringValue(result, "Target", "repository");

export const parseTrivyReport = (
  input: unknown,
  options: TrivyReportOptions = {},
): ParsedTrivyReport => {
  if (!isRecord(input)) return { securityIssues: [], vulnerabilities: [] };
  const vulnerabilities: SecurityFinding[] = [];
  const securityIssues: Diagnostic[] = [];

  for (const result of recordArray(input, "Results")) {
    const path = trivyPath(result, options);
    for (const vulnerability of recordArray(result, "Vulnerabilities")) {
      const id = stringValue(vulnerability, "VulnerabilityID", "unknown-vulnerability");
      const title = stringValue(vulnerability, "Title");
      const description = stringValue(vulnerability, "Description");
      vulnerabilities.push({
        ...(stringValue(vulnerability, "PrimaryURL")
          ? { detailsUrl: stringValue(vulnerability, "PrimaryURL") }
          : {}),
        fixedVersions: fixedVersions(stringValue(vulnerability, "FixedVersion")),
        id,
        line: 1,
        message: title || description || `${id} affects this artifact.`,
        packageName: stringValue(vulnerability, "PkgName", "unknown-package"),
        path,
        severity: stringValue(vulnerability, "Severity", "UNKNOWN").toUpperCase(),
        tool: "trivy",
      });
    }

    for (const misconfiguration of recordArray(result, "Misconfigurations")) {
      const metadata = misconfiguration.CauseMetadata;
      const line = isRecord(metadata) ? numberValue(metadata, "StartLine", 1) : 1;
      securityIssues.push({
        ...(stringValue(misconfiguration, "PrimaryURL")
          ? { detailsUrl: stringValue(misconfiguration, "PrimaryURL") }
          : {}),
        line,
        message:
          stringValue(misconfiguration, "Message") ||
          stringValue(misconfiguration, "Title") ||
          "Trivy found a security misconfiguration.",
        path,
        rule: stringValue(misconfiguration, "ID", "trivy-misconfiguration"),
        tool: "trivy",
      });
    }

    for (const secret of recordArray(result, "Secrets")) {
      securityIssues.push({
        line: numberValue(secret, "StartLine", 1),
        message: stringValue(secret, "Title", "Trivy found a potential secret."),
        path,
        rule: stringValue(secret, "RuleID", "trivy-secret"),
        tool: "trivy",
      });
    }
  }

  return { securityIssues, vulnerabilities };
};

const npmFixVersions = (value: unknown): readonly string[] => {
  if (value === true) return ["npm audit fix"];
  if (!isRecord(value)) return [];
  const version = stringValue(value, "version");
  return version ? [version] : ["npm audit fix"];
};

export const parseNpmAuditReport = (input: unknown): readonly SecurityFinding[] => {
  if (!isRecord(input) || !isRecord(input.vulnerabilities)) return [];
  const findings: SecurityFinding[] = [];
  for (const [packageKey, rawVulnerability] of Object.entries(input.vulnerabilities)) {
    if (!isRecord(rawVulnerability)) continue;
    const packageName = stringValue(rawVulnerability, "name", packageKey);
    const severity = stringValue(rawVulnerability, "severity", "UNKNOWN").toUpperCase();
    const fixes = npmFixVersions(rawVulnerability.fixAvailable);
    const via = rawVulnerability.via;
    const advisories = Array.isArray(via) ? via : [];
    for (const rawAdvisory of advisories) {
      if (typeof rawAdvisory === "string") {
        findings.push({
          fixedVersions: fixes,
          id: rawAdvisory,
          line: 1,
          message: `${packageName} depends on vulnerable package ${rawAdvisory}.`,
          packageName,
          path: "package-lock.json",
          severity,
          tool: "npm-audit",
        });
        continue;
      }
      if (!isRecord(rawAdvisory)) continue;
      const source = rawAdvisory.source;
      const id =
        typeof source === "number" || typeof source === "string"
          ? `GHSA-${String(source)}`
          : `${packageName}-advisory`;
      const url = stringValue(rawAdvisory, "url");
      findings.push({
        ...(url ? { detailsUrl: url } : {}),
        fixedVersions: fixes,
        id,
        line: 1,
        message: stringValue(rawAdvisory, "title", `${packageName} has a published advisory.`),
        packageName,
        path: "package-lock.json",
        severity: stringValue(rawAdvisory, "severity", severity).toUpperCase(),
        tool: "npm-audit",
      });
    }
  }
  return findings;
};

export const parsePipAuditReport = (input: unknown): readonly SecurityFinding[] => {
  if (!isRecord(input)) return [];
  const findings: SecurityFinding[] = [];
  for (const dependency of recordArray(input, "dependencies")) {
    const packageName = stringValue(dependency, "name", "unknown-package");
    for (const vulnerability of recordArray(dependency, "vulns")) {
      const id = stringValue(vulnerability, "id", "unknown-vulnerability");
      const rawFixes = vulnerability.fix_versions;
      const fixes = Array.isArray(rawFixes)
        ? rawFixes.filter((version): version is string => typeof version === "string")
        : [];
      findings.push({
        detailsUrl: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
        fixedVersions: fixes,
        id,
        line: 1,
        message: stringValue(vulnerability, "description", `${id} affects ${packageName}.`),
        packageName,
        path: "services/faster-whisper/requirements.lock",
        severity: "UNKNOWN",
        tool: "pip-audit",
      });
    }
  }
  return findings;
};

const sarifMessage = (result: JsonRecord): string => {
  const message = result.message;
  if (!isRecord(message)) return "The scanner reported an issue.";
  return (
    stringValue(message, "text") ||
    stringValue(message, "markdown") ||
    "The scanner reported an issue."
  );
};

const sarifLocation = (result: JsonRecord): { readonly line: number; readonly path: string } => {
  const location = recordArray(result, "locations")[0];
  if (!location || !isRecord(location.physicalLocation)) return { line: 1, path: "repository" };
  const physical = location.physicalLocation;
  const artifact = physical.artifactLocation;
  const region = physical.region;
  const rawPath = isRecord(artifact) ? stringValue(artifact, "uri", "repository") : "repository";
  let path = rawPath.replace(/^file:\/\//u, "").replaceAll("\\", "/");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep malformed scanner URIs printable and escaped by the renderer.
  }
  return {
    line: isRecord(region) ? numberValue(region, "startLine", 1) : 1,
    path: path.replace(/^\.\//u, ""),
  };
};

export const parseSarifReport = (input: unknown, tool: string): readonly Diagnostic[] => {
  if (!isRecord(input)) return [];
  const diagnostics: Diagnostic[] = [];
  for (const run of recordArray(input, "runs")) {
    const rules = new Map<string, string>();
    const toolEntry = run.tool;
    const driver = isRecord(toolEntry) ? toolEntry.driver : undefined;
    if (isRecord(driver)) {
      for (const rule of recordArray(driver, "rules")) {
        const id = stringValue(rule, "id");
        const helpUri = stringValue(rule, "helpUri");
        if (id && helpUri) rules.set(id, helpUri);
      }
    }
    for (const result of recordArray(run, "results")) {
      const rule = stringValue(result, "ruleId", `${tool}-finding`);
      const location = sarifLocation(result);
      const detailsUrl = rules.get(rule);
      diagnostics.push({
        ...(detailsUrl ? { detailsUrl } : {}),
        line: location.line,
        message: sarifMessage(result),
        path: location.path,
        rule,
        tool,
      });
    }
  }
  return diagnostics;
};
