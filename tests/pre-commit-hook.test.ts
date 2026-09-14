import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const packageManifestSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
  "lint-staged": z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});

describe("pre-commit quality hook", () => {
  it("runs the complete Biome check during the project quality command", async () => {
    const manifest = await readPackageManifest();

    expect(manifest.scripts?.["check:biome"]).toBe("biome check .");
    expect(manifest.scripts?.check).toMatch(/^npm run check:biome &&/);
  });

  it("installs the shared hook and fixes supported staged files before checking whitespace", async () => {
    const manifest = await readPackageManifest();
    const hook = await readFile(new URL("../.husky/pre-commit", import.meta.url), "utf8");

    expect(manifest.scripts?.prepare).toBe("husky");
    expect(manifest.devDependencies?.husky).toBeDefined();
    expect(manifest.devDependencies?.["lint-staged"]).toBeDefined();
    expect(manifest["lint-staged"]).toEqual({
      "*": "biome check --write --no-errors-on-unmatched --files-ignore-unknown=true",
    });
    expect(hook.trim().split(/\r?\n/)).toEqual(["npx lint-staged", "git diff --cached --check"]);
  });
});

async function readPackageManifest(): Promise<z.infer<typeof packageManifestSchema>> {
  const content = await readFile(new URL("../package.json", import.meta.url), "utf8");
  return packageManifestSchema.parse(JSON.parse(content));
}
