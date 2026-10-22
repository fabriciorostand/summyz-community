import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { assertSupportedRuntimePlatform } from "summyz-community-shared/runtime-platform";
import { describe, expect, it } from "vitest";

describe("runtime operating system support", () => {
  it("allows Windows and Linux", () => {
    expect(() => assertSupportedRuntimePlatform("win32")).not.toThrow();
    expect(() => assertSupportedRuntimePlatform("linux")).not.toThrow();
    expect(() => assertSupportedRuntimePlatform()).not.toThrow();
  });
  it("rejects unsupported native operating systems with a clear error", () => {
    for (const platform of ["darwin", "freebsd"] as const) {
      expect(() => assertSupportedRuntimePlatform(platform)).toThrow(
        "Summyz supports only Windows and Linux",
      );
    }
  });
  it("rejects all native entry points before config, dependencies, or files are initialized", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-unsupported-os-"));
    const execute = promisify(execFile);
    try {
      for (const entry of ["bot/src/main", "bot/src/bot-main", "api/src/main"]) {
        const url = new URL(`../../apps/${entry}.ts`, import.meta.url);
        const code = `Object.defineProperty(process, "platform", { value: "darwin" }); await import(${JSON.stringify(url.href)});`;
        await expect(
          execute(
            process.execPath,
            [
              "--conditions=development",
              "--import",
              import.meta.resolve("tsx"),
              "--input-type=module",
              "--eval",
              code,
            ],
            {
              cwd: directory,
              env: { ...process.env, DATABASE_URL: "invalid-config-sensitive" },
              timeout: 10_000,
              windowsHide: true,
            },
          ),
        ).rejects.toThrow("Summyz supports only Windows and Linux");
      }
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
