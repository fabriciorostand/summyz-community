import type { CognitiveMeasurement } from "./cognitive-complexity.js";
import type { MainComparison } from "./main-comparison.js";

export const QUALITY_GATE_MARKER = "<!-- summyz-community-quality-gate -->";

export interface GateConfig {
  readonly cognitiveComplexityMaximum: number;
  readonly complexityMaximum: number;
  readonly coverageMinimum: number;
  readonly duplicationMaximum: number;
  readonly moduleSlocMaximum: number;
}

export interface Diagnostic {
  readonly detailsUrl?: string;
  readonly line: number;
  readonly message: string;
  readonly path: string;
  readonly rule: string;
  readonly tool: string;
}

export interface SecurityFinding {
  readonly detailsUrl?: string;
  readonly fixedVersions: readonly string[];
  readonly id: string;
  readonly line: number;
  readonly message: string;
  readonly packageName: string;
  readonly path: string;
  readonly severity: string;
  readonly tool: string;
}

export interface ModuleSize {
  readonly changed: boolean;
  readonly path: string;
  readonly sloc: number;
}

export interface DuplicateLocation {
  readonly end: number;
  readonly path: string;
  readonly start: number;
}

export interface DuplicateGroup {
  readonly lines: number;
  readonly locations: readonly DuplicateLocation[];
}

export interface ComplexityFinding {
  readonly complexity: number;
  readonly line: number;
  readonly name: string;
  readonly path: string;
}

export interface GateMetrics {
  readonly baseSecurityFingerprints?: readonly string[];
  readonly changedOversizedModuleCount: number;
  readonly complexityFindings?: readonly ComplexityFinding[];
  readonly duplicateGroups?: readonly DuplicateGroup[];
  readonly jobResults: Readonly<Record<"quality" | "runtime" | "security" | "tests", string>>;
  readonly modules: readonly ModuleSize[];
  readonly newComplexityViolations: number;
  readonly newCognitiveComplexity?: CognitiveMeasurement;
  readonly newCoverage: number;
  readonly newCoverageAvailable: boolean;
  readonly newDuplication: number;
  readonly newIssues: readonly Diagnostic[];
  readonly newMaxComplexity: number;
  readonly repositoryCoverage: number;
  readonly repositoryCoverageAvailable: boolean;
  readonly repositoryDuplication: number;
  readonly repositoryIssues: readonly Diagnostic[];
  readonly repositoryMaxComplexity: number;
  readonly securityIssues?: readonly Diagnostic[];
  readonly securityFindings: readonly SecurityFinding[];
}

export interface EvaluatedMetrics extends GateMetrics {
  readonly newSecurity: readonly SecurityFinding[];
  readonly repositorySecurity: readonly SecurityFinding[];
}

export interface GateResult {
  readonly config: GateConfig;
  readonly failures: readonly string[];
  readonly metrics: EvaluatedMetrics;
  readonly passed: boolean;
}

export interface MarkdownContext {
  readonly commitSha: string;
  readonly detailsUrl: string;
  readonly repository: string;
  readonly mainComparison?: MainComparison;
}

export const DEFAULT_GATE_CONFIG: GateConfig = {
  cognitiveComplexityMaximum: 15,
  complexityMaximum: 10,
  coverageMinimum: 85,
  duplicationMaximum: 3,
  moduleSlocMaximum: 500,
};

const COGNITIVE_RULES = new Set(["lint/complexity/noExcessiveCognitiveComplexity", "CC001"]);

/**
 * Cognitive complexity is reported by Biome as lint diagnostics rather than as a metric, so the
 * gate reads the value back out of the message it renders.
 */
export const cognitiveComplexities = (diagnostics: readonly Diagnostic[]): readonly number[] =>
  diagnostics
    .filter((diagnostic) => COGNITIVE_RULES.has(diagnostic.rule))
    .flatMap((diagnostic) => {
      const match = /complexity of (\d+)/u.exec(diagnostic.message);
      return match?.[1] === undefined ? [] : [Number(match[1])];
    });

const normalizeSeverity = (severity: string): string => severity.trim().toUpperCase();

export const diagnosticFingerprint = (diagnostic: Diagnostic): string =>
  [diagnostic.tool, diagnostic.rule, diagnostic.path, diagnostic.message].join("\u0000");

export const securityFindingFingerprint = (finding: SecurityFinding): string =>
  [finding.id.trim().toUpperCase(), finding.packageName.trim().toLowerCase()].join("\u0000");

const uniqueSecurityFindings = (
  findings: readonly SecurityFinding[],
): readonly SecurityFinding[] => {
  const unique = new Map<string, SecurityFinding>();
  for (const finding of findings) {
    const fingerprint = securityFindingFingerprint(finding);
    if (!unique.has(fingerprint)) unique.set(fingerprint, finding);
  }
  return [...unique.values()];
};

export const isActionableSecurityFinding = (finding: SecurityFinding): boolean =>
  (normalizeSeverity(finding.severity) === "HIGH" ||
    normalizeSeverity(finding.severity) === "CRITICAL") &&
  finding.fixedVersions.some((version) => version.trim().length > 0);

const coverageFailure = (
  label: "New-code" | "Repository",
  available: boolean,
  percentage: number,
  minimum: number,
): string | undefined => {
  if (!available) {
    return `${label} coverage is unavailable because required coverage reports are missing.`;
  }
  if (percentage < minimum) {
    return `${label} coverage ${percentage.toFixed(2)}% is below ${minimum.toFixed(2)}%.`;
  }
  return undefined;
};

export const evaluateQualityGate = (
  metrics: GateMetrics,
  config: GateConfig = DEFAULT_GATE_CONFIG,
): GateResult => {
  const repositorySecurity = uniqueSecurityFindings(
    metrics.securityFindings.filter(isActionableSecurityFinding),
  );
  const baseFingerprints = new Set(metrics.baseSecurityFingerprints ?? []);
  const newSecurity = repositorySecurity.filter(
    (finding) => !baseFingerprints.has(securityFindingFingerprint(finding)),
  );
  const failures: string[] = [];

  const repositoryCoverageFailure = coverageFailure(
    "Repository",
    metrics.repositoryCoverageAvailable,
    metrics.repositoryCoverage,
    config.coverageMinimum,
  );
  if (repositoryCoverageFailure) failures.push(repositoryCoverageFailure);
  const newCoverageFailure = coverageFailure(
    "New-code",
    metrics.newCoverageAvailable,
    metrics.newCoverage,
    config.coverageMinimum,
  );
  if (newCoverageFailure) failures.push(newCoverageFailure);
  if (metrics.repositoryDuplication > config.duplicationMaximum) {
    failures.push(
      `Repository duplication ${metrics.repositoryDuplication.toFixed(2)}% exceeds ${config.duplicationMaximum.toFixed(2)}%.`,
    );
  }
  if (metrics.newDuplication > config.duplicationMaximum) {
    failures.push(
      `New-code duplication ${metrics.newDuplication.toFixed(2)}% exceeds ${config.duplicationMaximum.toFixed(2)}%.`,
    );
  }
  if (metrics.newComplexityViolations > 0) {
    failures.push(
      `New code introduces ${metrics.newComplexityViolations} function(s) above cyclomatic complexity ${config.complexityMaximum}.`,
    );
  }
  if (metrics.repositoryMaxComplexity > config.complexityMaximum) {
    failures.push(
      `Repository maximum cyclomatic complexity ${metrics.repositoryMaxComplexity} exceeds the configured limit of ${config.complexityMaximum}.`,
    );
  }
  const newCognitive = cognitiveComplexities(metrics.newIssues);
  if (newCognitive.length > 0) {
    failures.push(
      `New code introduces ${newCognitive.length} function(s) above cognitive complexity ${config.cognitiveComplexityMaximum}.`,
    );
  }

  const oversizedModules = metrics.modules.filter(
    (module) => module.sloc > config.moduleSlocMaximum,
  );
  for (const module of oversizedModules) {
    failures.push(
      `${module.path} has ${module.sloc} SLOC; the limit is ${config.moduleSlocMaximum}.`,
    );
  }
  if (metrics.newIssues.length > 0) {
    failures.push(`New code introduces ${metrics.newIssues.length} quality issue(s).`);
  }
  if (newSecurity.length > 0) {
    failures.push(
      `New code introduces ${newSecurity.length} fixable HIGH/CRITICAL vulnerability finding(s).`,
    );
  }
  for (const [job, status] of Object.entries(metrics.jobResults)) {
    if (status !== "success") failures.push(`Required job ${job} completed with status ${status}.`);
  }

  return {
    config,
    failures,
    metrics: { ...metrics, newSecurity, repositorySecurity },
    passed: failures.length === 0,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const markdownPath = (value: string): string => encodeURI(value.replaceAll("\\", "/"));

const icon = (
  passed: boolean,
  context: Pick<MarkdownContext, "commitSha" | "repository">,
): string => {
  const filename = passed ? "passed.svg" : "failed.svg";
  const alt = passed ? "passed" : "failed";
  const source = `https://github.com/${context.repository}/blob/${context.commitSha}/.github/assets/quality-gate/${filename}?raw=true`;
  return `<img src="${escapeHtml(source)}" width="11" height="11" alt="${alt}">`;
};

const detailsLink = (value: string, detailsUrl: string): string =>
  `<a href="${escapeHtml(detailsUrl)}">${value}</a>`;

const linkedMetric = (statusIcon: string, value: string, detailsUrl: string): string =>
  detailsLink(`${statusIcon}&nbsp;${escapeHtml(value)}`, detailsUrl);

const delta = (current: number, base: number | undefined, suffix = ""): string => {
  if (base === undefined) return "-";
  const difference = current - base;
  const sign = difference > 0 ? "+" : "";
  return `${sign}${difference.toFixed(2)}${suffix}`;
};

const integerDelta = (current: number, base: number | undefined): string => {
  if (base === undefined) return "-";
  const difference = current - base;
  return `${difference > 0 ? "+" : ""}${difference}`;
};

const coverageValue = (available: boolean, percentage: number): string =>
  available ? `${percentage.toFixed(2)}%` : "unavailable";

const sourceUrl = (
  context: Pick<MarkdownContext, "commitSha" | "repository">,
  path: string,
  line: number,
): string =>
  `https://github.com/${context.repository}/blob/${context.commitSha}/${markdownPath(path)}#L${line}`;

const renderDiagnostic = (
  diagnostic: Diagnostic,
  context: Pick<MarkdownContext, "commitSha" | "repository">,
  isNew: boolean,
): string => {
  const location = `${escapeHtml(diagnostic.path)}:${diagnostic.line}`;
  const ruleLink = diagnostic.detailsUrl ? ` ([rule](${escapeHtml(diagnostic.detailsUrl)}))` : "";
  return `- [${location}](${sourceUrl(context, diagnostic.path, diagnostic.line)}) — ${isNew ? "**new** — " : ""}\`${escapeHtml(diagnostic.rule)}\`: ${escapeHtml(diagnostic.message)}${ruleLink}`;
};

const renderSecurityFinding = (
  finding: SecurityFinding,
  context: Pick<MarkdownContext, "commitSha" | "repository">,
  isNew: boolean,
): string => {
  const location = `${escapeHtml(finding.path)}:${finding.line}`;
  const fix =
    finding.fixedVersions.length === 0
      ? "No fix has been published."
      : `Fix available: ${finding.fixedVersions.map(escapeHtml).join(", ")}.`;
  const details = finding.detailsUrl ? ` ([advisory](${escapeHtml(finding.detailsUrl)}))` : "";
  return `- [${location}](${sourceUrl(context, finding.path, finding.line)}) — ${isNew ? "**new** — " : ""}\`${escapeHtml(finding.id)}\`: ${escapeHtml(finding.message)} ${fix}${details}`;
};

const appendFailureDetails = (lines: string[], failures: readonly string[]): void => {
  if (failures.length === 0) return;
  lines.push("", "<details>", "<summary>Failure reasons</summary>", "");
  lines.push(...failures.map((failure) => `- ${escapeHtml(failure)}`));
  lines.push("", "</details>");
};

const appendIssueDetails = (
  lines: string[],
  metrics: EvaluatedMetrics,
  context: MarkdownContext,
  reportSecurityFindings: readonly SecurityFinding[],
): void => {
  const diagnostics = [
    ...metrics.repositoryIssues,
    ...(metrics.securityIssues ?? []),
    ...reportSecurityFindings,
  ];
  if (diagnostics.length === 0) return;
  const newIssueFingerprints = new Set(metrics.newIssues.map(diagnosticFingerprint));
  const newSecurityFingerprints = new Set(metrics.newSecurity.map(securityFindingFingerprint));
  lines.push("", "<details>", "<summary>Issue details</summary>", "");
  for (const diagnostic of metrics.repositoryIssues) {
    const fingerprint = diagnosticFingerprint(diagnostic);
    lines.push(renderDiagnostic(diagnostic, context, newIssueFingerprints.has(fingerprint)));
  }
  for (const diagnostic of metrics.securityIssues ?? []) {
    lines.push(renderDiagnostic(diagnostic, context, false));
  }
  for (const finding of reportSecurityFindings) {
    const isNew = newSecurityFingerprints.has(securityFindingFingerprint(finding));
    lines.push(renderSecurityFinding(finding, context, isNew));
  }
  lines.push("", "</details>");
};

const appendDuplicateDetails = (
  lines: string[],
  groups: readonly DuplicateGroup[],
  context: MarkdownContext,
): void => {
  if (groups.length === 0) return;
  lines.push("", "<details>", "<summary>Duplicated fragments</summary>", "");
  for (const group of groups) {
    const locations = group.locations
      .map(
        (location) =>
          `[${escapeHtml(location.path)}:${location.start}-${location.end}](${sourceUrl(context, location.path, location.start)})`,
      )
      .join(" · ");
    lines.push(`- ${group.lines} lines: ${locations}`);
  }
  lines.push("", "</details>");
};

const appendComplexityDetails = (
  lines: string[],
  findings: readonly ComplexityFinding[],
  maximum: number,
  context: MarkdownContext,
): void => {
  const violations = findings.filter((finding) => finding.complexity > maximum);
  if (violations.length === 0) return;
  lines.push("", "<details>", "<summary>Complex functions</summary>", "");
  for (const finding of violations) {
    lines.push(
      `- [${escapeHtml(finding.path)}:${finding.line}](${sourceUrl(context, finding.path, finding.line)}) — \`${escapeHtml(finding.name)}\`: ${finding.complexity}`,
    );
  }
  lines.push("", "</details>");
};

const mainValue = (value: number | undefined, suffix = ""): string =>
  value === undefined ? "-" : `${suffix === "%" ? value.toFixed(2) : value}${suffix}`;

const cognitiveValue = (value: CognitiveMeasurement | undefined): string =>
  value === undefined ? "-" : value.exact ? String(value.maximum) : `≤ ${value.maximum}`;

const signedInteger = (value: number): string => `${value > 0 ? "+" : ""}${value}`;

const cognitiveDelta = (
  current: CognitiveMeasurement | undefined,
  base: CognitiveMeasurement | undefined,
): string => {
  if (!current || !base) return "-";
  const lower = (current.exact ? current.maximum : 0) - base.maximum;
  const upper = current.maximum - (base.exact ? base.maximum : 0);
  return lower === upper
    ? signedInteger(lower)
    : `[${signedInteger(lower)}, ${signedInteger(upper)}]`;
};

const appendMainDetails = (lines: string[], context: MarkdownContext): void => {
  const comparison = context.mainComparison;
  const state = comparison?.state ?? "unavailable";
  if (state === "success") return;
  const reference = comparison?.commitSha
    ? ` ([${comparison.commitSha}](https://github.com/${context.repository}/commit/${comparison.commitSha}))`
    : "";
  lines.push("", `Main analysis ${state}${reference}.`);
  if (!comparison || comparison.failures.length === 0) return;
  lines.push("", "<details>", "<summary>Main analysis conditions</summary>", "");
  lines.push(...comparison.failures.map((failure) => `- ${escapeHtml(failure)}`));
  lines.push("", "</details>");
};

export const renderQualityGateMarkdown = (result: GateResult, context: MarkdownContext): string => {
  const { config, metrics } = result;
  const oversized = metrics.modules.filter((module) => module.sloc > config.moduleSlocMaximum);
  const changedOversized = oversized.filter((module) => module.changed);
  const reportSecurityFindings = uniqueSecurityFindings(metrics.securityFindings);
  const newCognitive = cognitiveComplexities(metrics.newIssues);
  const main = context.mainComparison;

  const rows: readonly (readonly string[])[] = [
    [
      "Issues",
      linkedMetric(
        icon(metrics.newIssues.length === 0, context),
        String(metrics.newIssues.length),
        context.detailsUrl,
      ),
      detailsLink(mainValue(main?.issueCount), context.detailsUrl),
      detailsLink(integerDelta(metrics.newIssues.length, main?.issueCount), context.detailsUrl),
      detailsLink("—", context.detailsUrl),
    ],
    [
      "Security",
      linkedMetric(
        icon(metrics.newSecurity.length === 0, context),
        String(metrics.newSecurity.length),
        context.detailsUrl,
      ),
      detailsLink(mainValue(main?.securityCount), context.detailsUrl),
      detailsLink(
        integerDelta(metrics.newSecurity.length, main?.securityCount),
        context.detailsUrl,
      ),
      detailsLink("HIGH/CRITICAL", context.detailsUrl),
    ],
    [
      "Coverage",
      linkedMetric(
        icon(
          metrics.newCoverageAvailable && metrics.newCoverage >= config.coverageMinimum,
          context,
        ),
        coverageValue(metrics.newCoverageAvailable, metrics.newCoverage),
        context.detailsUrl,
      ),
      detailsLink(mainValue(main?.coverage, "%"), context.detailsUrl),
      detailsLink(
        metrics.newCoverageAvailable ? delta(metrics.newCoverage, main?.coverage, " pp") : "-",
        context.detailsUrl,
      ),
      detailsLink(`≥ ${config.coverageMinimum}%`, context.detailsUrl),
    ],
    [
      "Duplication",
      linkedMetric(
        icon(metrics.newDuplication <= config.duplicationMaximum, context),
        `${metrics.newDuplication.toFixed(2)}%`,
        context.detailsUrl,
      ),
      detailsLink(mainValue(main?.duplication, "%"), context.detailsUrl),
      detailsLink(delta(metrics.newDuplication, main?.duplication, " pp"), context.detailsUrl),
      detailsLink(`≤ ${config.duplicationMaximum}%`, context.detailsUrl),
    ],
    [
      "Cyclomatic complexity",
      linkedMetric(
        icon(metrics.newComplexityViolations === 0, context),
        String(metrics.newMaxComplexity),
        context.detailsUrl,
      ),
      detailsLink(mainValue(main?.cyclomaticComplexity), context.detailsUrl),
      detailsLink(
        integerDelta(metrics.newMaxComplexity, main?.cyclomaticComplexity),
        context.detailsUrl,
      ),
      detailsLink(`≤ ${config.complexityMaximum}`, context.detailsUrl),
    ],
    [
      "Cognitive complexity",
      linkedMetric(
        icon(newCognitive.length === 0, context),
        cognitiveValue(metrics.newCognitiveComplexity),
        context.detailsUrl,
      ),
      detailsLink(cognitiveValue(main?.cognitiveComplexity), context.detailsUrl),
      detailsLink(
        cognitiveDelta(metrics.newCognitiveComplexity, main?.cognitiveComplexity),
        context.detailsUrl,
      ),
      detailsLink(`≤ ${config.cognitiveComplexityMaximum}`, context.detailsUrl),
    ],
    [
      `Modules over ${config.moduleSlocMaximum} SLOC`,
      linkedMetric(
        icon(changedOversized.length === 0, context),
        `${changedOversized.length} new`,
        context.detailsUrl,
      ),
      detailsLink(
        main?.oversizedModuleCount === undefined || main.moduleCount === undefined
          ? "-"
          : `${main.oversizedModuleCount} of ${main.moduleCount}`,
        context.detailsUrl,
      ),
      detailsLink(
        integerDelta(changedOversized.length, main?.oversizedModuleCount),
        context.detailsUrl,
      ),
      detailsLink(`≤ ${config.moduleSlocMaximum} SLOC`, context.detailsUrl),
    ],
  ];

  const lines = [
    QUALITY_GATE_MARKER,
    `## ${result.passed ? "✅ Quality Gate passed" : "❌ Quality Gate failed"}`,
    "",
    "| Measure | New code | Main | Δ from main | Rule |",
    "|---|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
    `[View analysis details](${escapeHtml(context.detailsUrl)})`,
  ];

  appendMainDetails(lines, context);
  appendFailureDetails(lines, result.failures);
  appendIssueDetails(lines, metrics, context, reportSecurityFindings);
  appendDuplicateDetails(lines, metrics.duplicateGroups ?? [], context);
  appendComplexityDetails(
    lines,
    metrics.complexityFindings ?? [],
    config.complexityMaximum,
    context,
  );

  return `${lines.join("\n")}\n`;
};
