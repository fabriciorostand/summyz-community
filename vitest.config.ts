import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["development", "node"] },
  test: {
    include: ["tests/integration/**/*.test.ts", "tests/repository/**/*.test.{ts,mjs}"],
    restoreMocks: true,
  },
});
