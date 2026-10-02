import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execute = promisify(execFile);

async function runEntryPoint(name: string, arguments_: readonly string[]) {
  const directory = await mkdtemp(join(tmpdir(), "summyz-api-entrypoint-"));
  try {
    return await execute(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL(`../src/api/${name}.ts`, import.meta.url)),
        ...arguments_,
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          DATABASE_URL: "postgresql://test:test@localhost:5432/test",
          SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 8).toString("base64url"),
          SUMMYZ_SETUP_TOKEN: "s".repeat(43),
          DASHBOARD_ACCESS_MODE: "local",
          PUBLIC_BASE_URL: "http://127.0.0.1:8787",
          WEB_HOST: "0.0.0.0",
        },
        timeout: 25_000,
        windowsHide: true,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("API startup arguments", () => {
  it.each(["main", "installation-access-recovery"])(
    "%s enforces public HTTPS before connecting to PostgreSQL",
    async (name) => {
      await expect(runEntryPoint(name, ["--access-mode", "public"])).rejects.toThrow(
        /PUBLIC_BASE_URL must use HTTPS/,
      );
    },
    30_000,
  );

  it.each(["main", "installation-access-recovery"])(
    "%s rejects conflicting access modes before connecting to PostgreSQL",
    async (name) => {
      await expect(
        runEntryPoint(name, ["--access-mode", "local", "--access-mode", "public"]),
      ).rejects.toThrow(/access mode must be specified only once/);
    },
    30_000,
  );

  it("keeps password recovery unavailable in local mode", async () => {
    await expect(
      runEntryPoint("installation-access-recovery", ["--access-mode", "local"]),
    ).rejects.toThrow(/password recovery is available only in public access mode/);
  }, 30_000);
});
