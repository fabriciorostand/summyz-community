import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const configSchema = z
  .object({
    linter: z
      .object({
        rules: z
          .object({
            complexity: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export const createCognitiveConfig = (value: unknown) => {
  const config = configSchema.parse(value);
  return {
    ...config,
    files: {
      includes: [
        "**",
        "!!**/*.test.ts",
        "!!**/*.test.tsx",
        "!!**/*.spec.ts",
        "!!**/*.spec.tsx",
        "!!**/*.d.ts",
      ],
    },
    linter: {
      ...config.linter,
      rules: {
        ...config.linter.rules,
        complexity: {
          ...config.linter.rules.complexity,
          noExcessiveCognitiveComplexity: { level: "warn", options: { maxAllowedComplexity: 1 } },
        },
      },
    },
  };
};

interface CollectionOptions {
  readonly rootPath: string;
  readonly pythonCommand?: readonly [string, ...string[]];
}

const pythonFindingsSchema = z.object({
  runs: z
    .array(
      z.object({
        results: z.array(z.object({ ruleId: z.literal("CC001") })).nonempty(),
      }),
    )
    .nonempty(),
});

export const collectCognitiveReports = async (options: CollectionOptions): Promise<void> => {
  const root = options.rootPath;
  const reports = join(root, "artifacts/reports/quality");
  await mkdir(reports, { recursive: true });
  const biomeReport = join(reports, "biome-cognitive.sarif");
  const pythonReport = join(reports, "complexipy-cognitive.sarif");
  await rm(biomeReport, { force: true });
  await rm(pythonReport, { force: true });
  const config = createCognitiveConfig(
    JSON.parse(await readFile(join(root, "biome.json"), "utf8")),
  );
  const configPath = join(root, `.biome-cognitive-${randomUUID()}.json`);
  try {
    await writeFile(configPath, JSON.stringify(config), "utf8");
    await run(
      process.execPath,
      [
        fileURLToPath(import.meta.resolve("@biomejs/biome/bin/biome")),
        "lint",
        "src",
        "web/src",
        `--config-path=${configPath}`,
        "--only=complexity/noExcessiveCognitiveComplexity",
        "--max-diagnostics=none",
        "--reporter=sarif",
        `--reporter-file=${biomeReport}`,
      ],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
  } finally {
    await rm(configPath, { force: true });
  }
  const [command, ...prefix] = options.pythonCommand ?? ["complexipy"];
  try {
    await run(
      command,
      [
        ...prefix,
        "services/faster-whisper",
        "--exclude",
        "test_*.py",
        "--cache-dir",
        ".cache/complexipy",
        "--max-complexity-allowed",
        "1",
        "--output-format",
        "sarif",
        "--output",
        pythonReport,
        "--quiet",
      ],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error: unknown) {
    // Scanner findings are expected at the measurement threshold; process failures are not.
    if (!(error instanceof Error) || !("code" in error) || error.code !== 1) throw error;
    const report: unknown = JSON.parse(await readFile(pythonReport, "utf8"));
    if (!pythonFindingsSchema.safeParse(report).success)
      throw new Error("Python cognitive measurement failed.");
  }
};
