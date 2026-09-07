import { mergeConfig } from "vitest/config";

import baseConfig from "./vitest.config.js";

export default mergeConfig(baseConfig, {
  test: {
    coverage: {
      exclude: ["scripts/**", "tests/**"],
      reporter: ["text", "html", "json", "json-summary", "cobertura"],
      reportsDirectory: "reports/server/coverage",
    },
    outputFile: {
      junit: "reports/server/junit.xml",
    },
    reporters: ["default", "junit"],
  },
});
