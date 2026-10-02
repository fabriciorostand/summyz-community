import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config.js";

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      reportOnFailure: true,
      exclude: ["scripts/**", "tests/**"],
      reporter: ["text", "html", "json", "json-summary", "cobertura"],
      reportsDirectory: "artifacts/reports/server/coverage",
    },
    // Private-repository runners have two cores and the default leaves one idle.
    maxWorkers: "100%",
    outputFile: {
      junit: "artifacts/reports/server/junit.xml",
    },
    reporters: ["default", "junit"],
  },
});
