import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: { conditions: ["development", "node"] },
  test: {
    include: ["tests/smoke/**/*.smoke.test.ts"],
    restoreMocks: true,
    testTimeout: 30 * 60 * 1_000,
  },
});
