import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createNodeTestConfig } from "../../scripts/test/node-project.js";
import smokeConfig from "../../tests/smoke/vitest.config.js";
import rootConfig from "../../vitest.config.js";

const repositoryConfig = (mode: string) => rootConfig({ command: "serve", mode });
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

it("keeps a single Vitest configuration at the repository root", async () => {
  const rootFiles = await readdir(new URL("../../", import.meta.url));
  expect(rootFiles.filter((file) => /^vitest\..*\.ts$/u.test(file))).toEqual(["vitest.config.ts"]);
});

it("measures every backend workspace and the repository suite as projects", () => {
  const projects = repositoryConfig("test").test?.projects;
  expect(projects?.slice(0, 3)).toEqual(["packages/shared", "apps/bot", "apps/api"]);
  expect(projects?.[3]).toMatchObject({
    resolve: { conditions: ["development", "node"] },
    test: {
      name: "repository",
      include: ["tests/integration/**/*.test.ts", "tests/repository/**/*.test.{ts,mjs}"],
      restoreMocks: true,
    },
  });
});

it("writes local coverage reports outside CI mode", () => {
  const { test } = repositoryConfig("test");
  expect(test?.coverage).toMatchObject({
    reporter: ["text", "html"],
    reportsDirectory: "artifacts/coverage/server",
  });
  expect(test?.coverage).not.toHaveProperty("reportOnFailure");
  expect(test).not.toHaveProperty("reporters");
});

it("publishes CI reports even when a test fails", () => {
  const { test } = repositoryConfig("ci");
  expect(test?.coverage).toMatchObject({
    reportOnFailure: true,
    reporter: ["text", "html", "json", "json-summary", "cobertura"],
    reportsDirectory: "artifacts/reports/server/coverage",
  });
  expect(test).toMatchObject({
    maxWorkers: "100%",
    outputFile: { junit: "artifacts/reports/server/junit.xml" },
    reporters: ["default", "junit"],
  });
});

it("keeps the local-AI smoke suite isolated beside its tests", () => {
  expect(smokeConfig.root).toBe(fileURLToPath(new URL("../../", import.meta.url)));
  expect(smokeConfig.test).toMatchObject({
    include: ["tests/smoke/**/*.smoke.test.ts"],
    testTimeout: 30 * 60 * 1_000,
  });
});

it("gates every backend application at 85% in the aggregate measurement", () => {
  const coverage = repositoryConfig("test").test?.coverage;
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
