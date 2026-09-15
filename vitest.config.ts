import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "tests/smoke/**", "web/**"],
    coverage: {
      exclude: [
        "scripts/**",
        "tests/**",
        "src/api/server-analytics-routes.ts",
        "src/api/server-auth-routes.ts",
        "src/api/server-setup-routes.ts",
        "src/api/server-support.ts",
        "src/api/server.ts",
        "src/api/installation-access-recovery.ts",
        "src/database/postgres-dashboard-session-store.ts",
        "src/database/postgres-installation-access-store.ts",
        "src/database/postgres-installation-settings-store.ts",
        "src/database/postgres-analytics-store.ts",
        "src/discord/discord-rest-guild-directory.ts",
      ],
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "artifacts/coverage/server",
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    restoreMocks: true,
  },
});
