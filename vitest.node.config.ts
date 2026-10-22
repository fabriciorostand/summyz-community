import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteUserConfig } from "vitest/config";

export const nodeCoverageExclusions = [
  "apps/api/src/server-analytics-routes.ts",
  "apps/api/src/server-auth-routes.ts",
  "apps/api/src/server-setup-routes.ts",
  "apps/api/src/server-support.ts",
  "apps/api/src/server.ts",
  "apps/api/src/installation-access-recovery.ts",
  "apps/api/src/discord/discord-rest-guild-directory.ts",
  "packages/shared/src/database/postgres-dashboard-session-store.ts",
  "packages/shared/src/database/postgres-installation-access-store.ts",
  "packages/shared/src/database/postgres-installation-settings-store.ts",
  "packages/shared/src/database/postgres-analytics-store.ts",
];
const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export function createNodeTestConfig(name: string, root: string): ViteUserConfig {
  return {
    root,
    resolve: { conditions: ["development", "node"] },
    test: {
      name,
      include: ["tests/**/*.test.ts"],
      restoreMocks: true,
      coverage: {
        provider: "v8",
        exclude: nodeCoverageExclusions.map((file) => resolve(repositoryRoot, file)),
        reporter: ["text", "html", "json", "json-summary", "cobertura"],
        reportsDirectory: resolve(repositoryRoot, `artifacts/reports/${name}/coverage`),
        thresholds: { branches: 85, functions: 85, lines: 85, statements: 85 },
      },
    },
  };
}
