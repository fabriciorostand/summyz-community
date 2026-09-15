import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const launcherName =
  process.platform === "win32" ? "summyz-community-public.ps1" : "summyz-community-public";

describe("public Community launcher", () => {
  it("creates .env before asking for the public HTTPS origin", async () => {
    const fixture = await createFixture(undefined);
    try {
      await expect(runLauncher(fixture)).rejects.toThrow(/PUBLIC_BASE_URL must use HTTPS/i);
      const environment = await readFile(join(fixture, ".env"), "utf8");
      expect(environment).toMatch(/SUMMYZ_SETUP_TOKEN=[A-Za-z0-9_-]{43}/u);
      expect(environment).toMatch(/POSTGRES_PASSWORD=[A-Za-z0-9_-]{43}/u);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("starts the public TLS overlay using the URL from .env", async () => {
    const fixture = await createFixture("PUBLIC_BASE_URL=https://bot.example.com\n");
    try {
      const output = await runLauncher(fixture);

      expect(output).toContain("docker/compose.public.yaml");
      expect(output).toContain("up -d --build");
      expect(output).not.toContain("setup-token-sensitive");
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });

  it("rejects public startup without an HTTPS base URL", async () => {
    const fixture = await createFixture("PUBLIC_BASE_URL=http://bot.example.com\n");
    try {
      await expect(runLauncher(fixture)).rejects.toThrow(/PUBLIC_BASE_URL must use HTTPS/i);
    } finally {
      await rm(fixture, { force: true, recursive: true });
    }
  });
});

async function createFixture(publicSetting: string | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "summyz-public-launcher-"));
  await Promise.all([
    copyFile(join(repositoryRoot, launcherName), join(root, launcherName)),
    copyFile(
      join(
        repositoryRoot,
        process.platform === "win32" ? "summyz-community.ps1" : "summyz-community",
      ),
      join(root, process.platform === "win32" ? "summyz-community.ps1" : "summyz-community"),
    ),
    copyFile(join(repositoryRoot, ".env.example"), join(root, ".env.example")),
  ]);
  if (publicSetting !== undefined) {
    const template = await readFile(join(root, ".env.example"), "utf8");
    await writeFile(
      join(root, ".env"),
      `${publicSetting}${template}`
        .replace(/^SUMMYZ_SETUP_TOKEN=.*$/m, "SUMMYZ_SETUP_TOKEN=setup-token-sensitive")
        .replace(/^SUMMYZ_SECRETS_KEY=.*$/m, `SUMMYZ_SECRETS_KEY=${"a".repeat(43)}`)
        .replace(/^POSTGRES_PASSWORD=.*$/m, "POSTGRES_PASSWORD=database-password")
        .replace(
          /^DATABASE_URL=.*$/m,
          "DATABASE_URL=postgresql://summyz_community:database-password@postgres:5432/summyz-community-db",
        ),
    );
  }
  return root;
}

async function runLauncher(root: string): Promise<string> {
  if (process.platform === "win32") {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(root, launcherName),
        "up",
        "--dry-run",
      ],
      { encoding: "utf8" },
    );
    return result.stdout;
  }
  const result = await execFileAsync("sh", [join(root, launcherName), "up", "--dry-run"], {
    encoding: "utf8",
  });
  return result.stdout;
}
