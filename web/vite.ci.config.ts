import { mergeConfig } from "vitest/config";

import baseConfig from "./vite.config.js";

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      all: true,
      exclude: ["src/main.tsx", "src/tests/test-utils.tsx"],
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary", "cobertura", "lcovonly"],
      reportsDirectory: "../artifacts/reports/web/coverage",
      thresholds: {
        lines: 85,
        statements: 85,
      },
    },
    // Private-repository runners have two cores and the default leaves one idle.
    maxWorkers: "100%",
    outputFile: {
      junit: "../artifacts/reports/web/junit.xml",
    },
    reporters: ["default", "junit"],
  },
});
