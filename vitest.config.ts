import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "tests/smoke/**", "web/**"],
    coverage: {
      exclude: [
        "src/api/server-analytics-routes.ts",
        "src/api/server-auth-routes.ts",
        "src/api/server.ts",
        "src/auth/smtp-email-sender.ts",
        "src/database/postgres-auth-repository.ts",
        "src/database/postgres-discord-connection-store.ts",
        "src/database/postgres-installation-settings-store.ts",
        "src/database/postgres-analytics-store.ts",
        "src/discord/discord-oauth-service.ts",
        "src/discord/discord-rest-guild-directory.ts",
      ],
      provider: "v8",
      reporter: ["text", "html"],
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
