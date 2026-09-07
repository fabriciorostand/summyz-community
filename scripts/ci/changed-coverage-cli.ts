import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { aggregateDiffCoverage } from "./quality-gate-inputs.js";

const main = async (): Promise<void> => {
  const [serverPath, dashboardPath, pythonPath, jsonOutputPath, markdownOutputPath] =
    process.argv.slice(2);
  if (!serverPath || !dashboardPath || !pythonPath || !jsonOutputPath || !markdownOutputPath) {
    throw new Error(
      "Usage: changed-coverage-cli <server.json> <dashboard.json> <python.json> <output.json> <output.md>",
    );
  }
  const reports = await Promise.all(
    [serverPath, dashboardPath, pythonPath].map(async (path) =>
      JSON.parse(await readFile(resolve(path), "utf8")),
    ),
  );
  const result = aggregateDiffCoverage(reports);
  const jsonOutput = resolve(jsonOutputPath);
  const markdownOutput = resolve(markdownOutputPath);
  await Promise.all([
    mkdir(dirname(jsonOutput), { recursive: true }),
    mkdir(dirname(markdownOutput), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(jsonOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(
      markdownOutput,
      [
        "# New-code coverage",
        "",
        `- Covered executable lines: ${result.covered}`,
        `- Total executable lines: ${result.total}`,
        `- Coverage: ${result.percentage.toFixed(2)}%`,
        "- Required: 85.00%",
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);
  if (result.percentage < 85) process.exitCode = 1;
};

await main();
