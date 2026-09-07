import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface FileCoverage {
  covered: number;
  total: number;
}

export interface CoverageDomain {
  name: string;
  patterns: readonly string[];
}

export interface DomainCoverageResult extends FileCoverage {
  name: string;
  passed: boolean;
  percentage: number;
}

const serverDomains: readonly CoverageDomain[] = [
  { name: "recording-manifest-recovery", patterns: ["/src/recording/"] },
  {
    name: "processing-ai-pipeline",
    patterns: [
      "/src/processing/",
      "/src/transcription/",
      "/src/refinement/",
      "/src/summary/",
      "/src/translation/",
      "/src/openrouter/",
      "/src/local-ai/",
    ],
  },
  {
    name: "database-queue-retention-cost-analytics",
    patterns: ["/src/database/", "/src/processing/", "/src/cost/", "/src/analytics/"],
  },
  {
    name: "auth-security-discord-api",
    patterns: ["/src/auth/", "/src/security/", "/src/discord/", "/src/api/"],
  },
];

const webDomains: readonly CoverageDomain[] = [
  {
    name: "authentication-onboarding-account",
    patterns: [
      "/web/src/account-pages.tsx",
      "/web/src/app.tsx",
      "/web/src/auth-pages.tsx",
      "/web/src/installation-page.tsx",
    ],
  },
  {
    name: "guild-configuration-profiles",
    patterns: [
      "/web/src/guild-configuration-page.tsx",
      "/web/src/profile-editor.tsx",
      "/web/src/profile-language.tsx",
      "/web/src/profile-phase-editor.tsx",
      "/web/src/profile-vad-editor.tsx",
      "/web/src/profiles-page.tsx",
    ],
  },
  {
    name: "analytics-meeting-history",
    patterns: [
      "/web/src/analytics-dashboard-page.tsx",
      "/web/src/analytics-format.ts",
      "/web/src/meeting-history-detail-page.tsx",
      "/web/src/meeting-history-page.tsx",
    ],
  },
  {
    name: "api-client-shared-ui",
    patterns: ["/web/src/api.ts", "/web/src/components.tsx"],
  },
];

const pythonDomains: readonly CoverageDomain[] = [
  {
    name: "transcription-api",
    patterns: ["/server.py", "/transcription_options.py", "/language.py"],
  },
  {
    name: "model-lifecycle-capability",
    patterns: ["/server.py", "/model_inventory.py", "/model_capability.py"],
  },
  {
    name: "execution-policy-logging",
    patterns: ["/execution_policy.py", "/structured_logging.py"],
  },
];

export function evaluateCoverageDomains(
  files: Readonly<Record<string, FileCoverage>>,
  domains: readonly CoverageDomain[],
  minimum: number,
): DomainCoverageResult[] {
  return domains.map((domain) => {
    const matching = Object.entries(files).filter(([file]) =>
      domain.patterns.some((pattern) => normalize(file).includes(pattern)),
    );
    const total = matching.reduce((sum, [, coverage]) => sum + coverage.total, 0);
    const covered = matching.reduce((sum, [, coverage]) => sum + coverage.covered, 0);
    const percentage = total === 0 ? 0 : Number(((covered / total) * 100).toFixed(2));
    return {
      covered,
      name: domain.name,
      passed: total > 0 && percentage >= minimum,
      percentage,
      total,
    };
  });
}

async function main(): Promise<void> {
  const [serverPath, webPath, pythonPath, outputPath] = process.argv.slice(2);
  if ([serverPath, webPath, pythonPath, outputPath].some((value) => value === undefined)) {
    throw new Error(
      "Usage: coverage-domains <server-summary.json> <web-summary.json> <python-coverage.json> <output.json>",
    );
  }
  if (serverPath === undefined || webPath === undefined || pythonPath === undefined) return;
  if (outputPath === undefined) return;

  const components = {
    python: evaluateCoverageDomains(await readPythonCoverage(pythonPath), pythonDomains, 85),
    server: evaluateCoverageDomains(await readIstanbulSummary(serverPath), serverDomains, 85),
    web: evaluateCoverageDomains(await readIstanbulSummary(webPath), webDomains, 85),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(components, null, 2)}\n`, "utf8");
  const markdown = [
    "## Domain coverage",
    "",
    "| Component | Domain | Lines | Result |",
    "| --- | --- | ---: | --- |",
    ...Object.entries(components).flatMap(([component, results]) =>
      results.map(
        (result) =>
          `| ${component} | ${result.name} | ${result.percentage.toFixed(2)}% | ${result.passed ? "pass" : "fail"} |`,
      ),
    ),
    "",
  ].join("\n");
  await writeFile(outputPath.replace(/\.json$/u, ".md"), markdown, "utf8");
  process.stdout.write(markdown);

  if (Object.values(components).some((results) => results.some((result) => !result.passed))) {
    process.exitCode = 1;
  }
}

async function readIstanbulSummary(path: string): Promise<Record<string, FileCoverage>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value)) throw new Error(`Invalid Istanbul summary: ${path}`);
  const result: Record<string, FileCoverage> = {};
  for (const [file, entry] of Object.entries(value)) {
    if (file === "total" || !isRecord(entry) || !isRecord(entry.lines)) continue;
    const coverage = parseCoverage(entry.lines);
    if (coverage !== undefined) result[file] = coverage;
  }
  return result;
}

async function readPythonCoverage(path: string): Promise<Record<string, FileCoverage>> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value) || !isRecord(value.files)) {
    throw new Error(`Invalid Python coverage report: ${path}`);
  }
  const result: Record<string, FileCoverage> = {};
  for (const [file, entry] of Object.entries(value.files)) {
    if (!isRecord(entry) || !isRecord(entry.summary)) continue;
    const total = entry.summary.num_statements;
    const covered = entry.summary.covered_lines;
    if (typeof total === "number" && typeof covered === "number") {
      result[file] = { covered, total };
    }
  }
  return result;
}

function parseCoverage(value: Record<string, unknown>): FileCoverage | undefined {
  return typeof value.covered === "number" && typeof value.total === "number"
    ? { covered: value.covered, total: value.total }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalize(path: string): string {
  return `/${path.replaceAll("\\", "/").replace(/^\/+/, "")}`;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(resolve(entryPoint)).href) {
  await main();
}
