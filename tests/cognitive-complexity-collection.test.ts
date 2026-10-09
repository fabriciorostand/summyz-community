import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  collectCognitiveReports,
  createCognitiveConfig,
} from "../scripts/ci/cognitive-complexity-collection.js";

describe("independent cognitive metric collection", () => {
  it.each([
    { code: 2, report: "", message: /Command failed/u },
    {
      code: 1,
      report: JSON.stringify({ runs: [{ results: [] }] }),
      message: /Python cognitive measurement failed/u,
    },
    { code: 1, report: "{", message: /JSON/u },
  ])(
    "rejects scanner process failures instead of treating them as findings",
    async ({ code, report, message }) => {
      const root = await mkdtemp(join(process.cwd(), ".cognitive-test-"));
      try {
        await mkdir(join(root, "src"));
        await mkdir(join(root, "web/src"), { recursive: true });
        await writeFile(join(root, "biome.json"), await readFile("biome.json", "utf8"));
        await writeFile(join(root, "src/example.ts"), "export const choose = () => 0;");
        const python = join(root, "python-scanner.cjs");
        await writeFile(
          python,
          `const fs = require("node:fs"); const args = process.argv.slice(2);
        fs.writeFileSync(args[args.indexOf("--output") + 1], ${JSON.stringify(report)});
        process.exit(${code});`,
        );
        await expect(
          collectCognitiveReports({ rootPath: root, pythonCommand: [process.execPath, python] }),
        ).rejects.toThrow(message);
        const { readdir } = await import("node:fs/promises");
        expect(
          (await readdir(root)).filter((file) => file.startsWith(".biome-cognitive-")),
        ).toEqual([]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("reports collection failure without leaking scanner input into logs", async () => {
    const root = await mkdtemp(join(process.cwd(), ".cognitive-test-"));
    try {
      await writeFile(
        join(root, "biome.json"),
        JSON.stringify({ linter: null, token: "must-never-log-this-secret" }),
      );
      const cli = fileURLToPath(
        new URL("../scripts/ci/collect-cognitive-complexity-cli.ts", import.meta.url),
      );
      const output = await new Promise<{
        code: string | number | undefined;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        execFile(
          process.execPath,
          ["--import", import.meta.resolve("tsx"), cli],
          { cwd: root },
          (error, stdout, stderr) => {
            resolve({ code: error?.code, stdout, stderr });
          },
        );
      });
      expect(output.code).toBe(1);
      expect(output.stderr).toContain("cognitive_measurement_failed");
      expect(output.stdout + output.stderr).not.toContain("must-never-log-this-secret");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("sets only the presentation scan to threshold one and excludes tests", () => {
    const original = {
      linter: {
        rules: {
          complexity: {
            noExcessiveCognitiveComplexity: {
              level: "error",
              options: { maxAllowedComplexity: 15 },
            },
          },
        },
      },
      formatter: { enabled: true },
    };
    const measurement = createCognitiveConfig(original);
    expect(measurement.linter.rules.complexity.noExcessiveCognitiveComplexity).toEqual({
      level: "warn",
      options: { maxAllowedComplexity: 1 },
    });
    expect(
      original.linter.rules.complexity.noExcessiveCognitiveComplexity.options.maxAllowedComplexity,
    ).toBe(15);
    expect(measurement.files.includes).toContain("!!**/*.test.tsx");
  });

  it("collects real Biome scores, accepts Python findings, and cleans up its temporary config", async () => {
    const root = await mkdtemp(join(process.cwd(), ".cognitive-test-"));
    try {
      await mkdir(join(root, "src"));
      await mkdir(join(root, "web/src"), { recursive: true });
      const config = {
        linter: {
          rules: {
            complexity: {
              noExcessiveCognitiveComplexity: {
                level: "error",
                options: { maxAllowedComplexity: 15 },
              },
            },
          },
        },
      };
      await writeFile(join(root, "biome.json"), JSON.stringify(config));
      await writeFile(
        join(root, "src/example.ts"),
        "export function choose(a: boolean, b: boolean) { if (a) { if (b) return 1; } return 0; }",
      );
      await writeFile(
        join(root, "web/src/example.test.tsx"),
        "export function test(a: boolean) { if(a) { if(a) return 1; } return 0; }",
      );
      const python = join(root, "python-scanner.cjs");
      await writeFile(
        python,
        `const fs = require("node:fs"); const args = process.argv.slice(2);
        fs.writeFileSync(args[args.indexOf("--output") + 1], JSON.stringify({runs: [{results: [{ruleId: "CC001"}]}]}));
        process.exit(1);`,
      );
      await collectCognitiveReports({ rootPath: root, pythonCommand: [process.execPath, python] });
      const report: unknown = JSON.parse(
        await readFile(join(root, "artifacts/reports/quality/biome-cognitive.sarif"), "utf8"),
      );
      expect(JSON.stringify(report)).toContain("complexity of 3");
      expect(JSON.stringify(report)).not.toContain("example.test.tsx");
      expect(JSON.parse(await readFile(join(root, "biome.json"), "utf8"))).toEqual(config);
      const { readdir } = await import("node:fs/promises");
      expect((await readdir(root)).filter((file) => file.startsWith(".biome-cognitive-"))).toEqual(
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});

import { execFile } from "node:child_process";
