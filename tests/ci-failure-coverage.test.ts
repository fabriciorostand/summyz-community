import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";

const execute = promisify(execFile);

it("publishes CI coverage after an assertion failure while preserving the failed exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "summyz-failed-coverage-"));
  const configuration = fileURLToPath(new URL("../vitest.ci.config.ts", import.meta.url));
  const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  try {
    await writeFile(join(directory, "sample.js"), "export function sample() { return 1; }\n");
    await writeFile(
      join(directory, "sample.test.js"),
      'import { sample } from "./sample.js";\nit("intentional failure", () => expect(sample()).toBe(2));\n',
    );
    await writeFile(
      join(directory, "vitest.config.mjs"),
      `import configuration from ${JSON.stringify(configuration.replaceAll("\\", "/"))};
export default {
  ...configuration,
  root: ${JSON.stringify(directory.replaceAll("\\", "/"))},
  test: {
    ...configuration.test,
    globals: true,
    include: ["sample.test.js"],
    maxWorkers: 1,
    reporters: ["dot"],
    coverage: {
      ...configuration.test.coverage,
      include: ["sample.js"],
      reportsDirectory: "coverage",
      reporter: ["json-summary", "cobertura"],
      thresholds: { branches: 0, functions: 0, lines: 0, statements: 0 },
    },
  },
};
`,
    );
    await expect(
      execute(process.execPath, [
        vitest,
        "run",
        "--config",
        join(directory, "vitest.config.mjs"),
        "--coverage",
      ]),
    ).rejects.toMatchObject({ code: 1 });
    const summary = z
      .object({ total: z.object({ lines: z.object({ total: z.number(), covered: z.number() }) }) })
      .parse(
        JSON.parse(await readFile(join(directory, "coverage", "coverage-summary.json"), "utf8")),
      );
    expect(summary.total.lines.total).toBeGreaterThan(0);
    expect(summary.total.lines.covered).toBeGreaterThan(0);
    expect(await readFile(join(directory, "coverage", "cobertura-coverage.xml"), "utf8")).toContain(
      'filename="sample.js"',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
