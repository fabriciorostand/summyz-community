import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createNodeTestConfig } from "../../vitest.node.config.js";
import serverConfig from "../../vitest.server.config.js";

const minimum = { branches: 85, functions: 85, lines: 85, statements: 85 };
const workspaceRoot = (workspace: string) =>
  fileURLToPath(new URL(`../../${workspace}/`, import.meta.url));

it.each([
  [
    "apps/api",
    [
      "src/server-analytics-routes.ts",
      "src/server-auth-routes.ts",
      "src/server-setup-routes.ts",
      "src/server-support.ts",
      "src/server.ts",
      "src/installation-access-recovery.ts",
      "src/discord/discord-rest-guild-directory.ts",
    ],
  ],
  [
    "packages/shared",
    [
      "src/database/postgres-dashboard-session-store.ts",
      "src/database/postgres-installation-access-store.ts",
      "src/database/postgres-installation-settings-store.ts",
      "src/database/postgres-analytics-store.ts",
    ],
  ],
  ["apps/bot", []],
])("excludes %s files with globs relative to the workspace root", (workspace, expected) => {
  const config = createNodeTestConfig(workspace.split("/").at(-1) ?? "", workspaceRoot(workspace));
  expect(config.test?.coverage?.exclude).toEqual(expected);
});

it.each(["apps/api", "apps/bot", "packages/shared"])(
  "reports %s coverage without a workspace-only gate",
  (workspace) => {
    const config = createNodeTestConfig(
      workspace.split("/").at(-1) ?? "",
      workspaceRoot(workspace),
    );
    expect(config.test?.coverage).not.toHaveProperty("thresholds");
  },
);

it("gates every backend application at 85% in the aggregate measurement", () => {
  const coverage = serverConfig.test?.coverage;
  expect(coverage?.thresholds).toEqual({
    ...minimum,
    "apps/bot/src/**": minimum,
    "apps/api/src/**": minimum,
    "packages/shared/src/**": minimum,
  });
  expect(coverage?.exclude).toContain("*.config.ts");
});

it("gates every dashboard coverage metric at 85%", async () => {
  const config = await readFile(
    new URL("../../apps/dashboard/vite.ci.config.ts", import.meta.url),
    "utf8",
  );
  const thresholds = /thresholds: \{([^}]*)\}/u.exec(config)?.[1] ?? "";
  for (const metric of Object.keys(minimum)) expect(thresholds).toContain(`${metric}: 85`);
});
