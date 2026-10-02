import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { assertSupportedRuntimePlatform } from "../src/runtime-platform.js";

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
      for (const entry of ["main", "bot-main", "api/main"]) {
        const url = new URL(`../src/${entry}.ts`, import.meta.url);
        const code = `Object.defineProperty(process, "platform", { value: "darwin" }); await import(${JSON.stringify(url.href)});`;
        await expect(
          execute(
            process.execPath,
            ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", code],
            {
              cwd: directory,
              env: { ...process.env, DATABASE_URL: "invalid-config-sensitive" },
              windowsHide: true,
            },
          ),
        ).rejects.toThrow("Summyz supports only Windows and Linux");
      }
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
