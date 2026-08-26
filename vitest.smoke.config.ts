import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/smoke/**/*.smoke.test.ts"],
    restoreMocks: true,
    testTimeout: 30 * 60 * 1_000,
  },
});
