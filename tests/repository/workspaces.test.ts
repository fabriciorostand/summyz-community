import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = new URL("../../", import.meta.url);
const workspacePaths = ["packages/shared", "apps/bot", "apps/api", "apps/dashboard"];
const manifestSchema = z.object({
  name: z.string(),
  private: z.literal(true),
  workspaces: z.array(z.string()).optional(),
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()).optional(),
});
const readManifest = async (path: string) =>
  manifestSchema.parse(JSON.parse(await readFile(new URL(path, root), "utf8")));

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : [path];
    }),
  );
  return files.flat().filter((path) => /\.tsx?$/u.test(path));
}

describe("npm workspace boundaries", () => {
  it("owns source and tests inside each of the four private workspaces", async () => {
    expect((await readManifest("package.json")).workspaces).toEqual(workspacePaths);
    for (const workspace of workspacePaths) {
      const manifest = await readManifest(`${workspace}/package.json`);
      expect(manifest.name).toBe(`summyz-community-${workspace.split("/").at(-1)}`);
      for (const directory of ["src", "tests"]) {
        expect(await readdir(new URL(`${workspace}/${directory}/`, root))).not.toHaveLength(0);
      }
      for (const script of ["build", "test", "test:coverage", "typecheck"]) {
        expect(manifest.scripts[script]).toBeTypeOf("string");
      }
    }
    await expect(readdir(new URL("src/", root))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(new URL("web/", root))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("coordinates every fast suite and keeps local inference isolated", async () => {
    const { scripts } = await readManifest("package.json");
    expect(scripts.test).toContain("test:workspaces");
    expect(scripts.test).toContain("test:root");
    expect(scripts.test).toContain("test:python");
    expect(scripts["test:workspaces"]).toBe("npm run test --workspaces");
    expect(scripts.test).not.toContain("test:smoke");
    expect(Object.keys(scripts).some((name) => name.includes(":web"))).toBe(false);
    const config = await readFile(new URL("vitest.config.ts", root), "utf8");
    expect(config).toContain("tests/integration/**/*.test.ts");
    expect(config).toContain("tests/repository/**/*.test.{ts,mjs}");
  });

  it("keeps production dependencies directed from applications to shared code", async () => {
    for (const workspace of workspacePaths) {
      const files = await sourceFiles(fileURLToPath(new URL(`${workspace}/src/`, root)));
      for (const file of files) {
        const content = await readFile(file, "utf8");
        expect(content, file).not.toMatch(
          /(?:from\s*|import\s*)["']summyz-community-(?:bot|api|dashboard)\//u,
        );
        expect(content, file).not.toMatch(
          /(?:from\s*|import\s*)["'][^"']*\.\.\/[^"']*(?:apps|packages)\//u,
        );
      }
    }
    expect((await readManifest("apps/bot/package.json")).dependencies).toHaveProperty(
      "summyz-community-shared",
    );
    expect((await readManifest("apps/api/package.json")).dependencies).toHaveProperty(
      "summyz-community-shared",
    );
    expect((await readManifest("packages/shared/package.json")).dependencies).not.toHaveProperty(
      "summyz-community-bot",
    );
  });
});
