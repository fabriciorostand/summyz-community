import { defineConfig } from "vitest/config";
import { nodeCoverageExclusions } from "./scripts/test/node-project.js";

const minimumCoverage = { branches: 85, functions: 85, lines: 85, statements: 85 };

export default defineConfig(({ mode }) => ({
  test: {
    projects: [
      "packages/shared",
      "apps/bot",
      "apps/api",
      {
        resolve: { conditions: ["development", "node"] },
        test: {
          name: "repository",
          include: ["tests/integration/**/*.test.ts", "tests/repository/**/*.test.{ts,mjs}"],
          restoreMocks: true,
        },
      },
    ],
    coverage: {
      provider: "v8",
      exclude: ["scripts/**", "tests/**", "*.config.ts", ...nodeCoverageExclusions],
      ...(mode === "ci"
        ? {
            reportOnFailure: true,
            reporter: ["text", "html", "json", "json-summary", "cobertura"],
            reportsDirectory: "artifacts/reports/server/coverage",
          }
        : { reporter: ["text", "html"], reportsDirectory: "artifacts/coverage/server" }),
      // Each application must reach the minimum on its own, not only through the combined total.
      thresholds: {
        ...minimumCoverage,
        "apps/bot/src/**": minimumCoverage,
        "apps/api/src/**": minimumCoverage,
        "packages/shared/src/**": minimumCoverage,
      },
    },
    ...(mode === "ci"
      ? {
          // Private-repository runners have two cores and the default leaves one idle.
          maxWorkers: "100%",
          outputFile: { junit: "artifacts/reports/server/junit.xml" },
          reporters: ["default", "junit"],
        }
      : {}),
  },
}));
