import { defineConfig } from "vitest/config";
import { nodeCoverageExclusions } from "./vitest.node.config.js";

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
      exclude: ["scripts/**", "tests/**", ...nodeCoverageExclusions],
      reporter: ["text", "html"],
      reportsDirectory: "artifacts/coverage/server",
      thresholds: { branches: 85, functions: 85, lines: 85, statements: 85 },
    },
  },
});
