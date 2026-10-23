import { defineConfig } from "vitest/config";
import { nodeCoverageExclusions } from "./vitest.node.config.js";

const minimumCoverage = { branches: 85, functions: 85, lines: 85, statements: 85 };

export default defineConfig({
  resolve: { conditions: ["development", "node"] },
  test: {
    include: [
      "apps/bot/tests/**/*.test.ts",
      "apps/api/tests/**/*.test.ts",
      "packages/shared/tests/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/repository/**/*.test.{ts,mjs}",
    ],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      exclude: ["scripts/**", "tests/**", "*.config.ts", ...nodeCoverageExclusions],
      reporter: ["text", "html"],
      reportsDirectory: "artifacts/coverage/server",
      thresholds: {
        ...minimumCoverage,
        "apps/bot/src/**": minimumCoverage,
        "apps/api/src/**": minimumCoverage,
        "packages/shared/src/**": minimumCoverage,
      },
    },
  },
});
