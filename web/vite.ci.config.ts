import { mergeConfig } from "vitest/config";

import baseConfig from "./vite.config.js";

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      all: true,
      exclude: ["src/main.tsx"],
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "html", "json", "json-summary", "cobertura", "lcovonly"],
      reportsDirectory: "../reports/web/coverage",
      thresholds: {
        lines: 85,
        statements: 85,
      },
    },
    outputFile: {
      junit: "../reports/web/junit.xml",
    },
    reporters: ["default", "junit"],
  },
});
