import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const launcherName = process.platform === "win32" ? "summyz-community.ps1" : "summyz-community";

describe("Community launcher", () => {
  it("seleciona CPU sem adicionar overlay", async () => {
    const output = await runLauncher({ LOCAL_AI_DEVICE: "cpu" });

    expect(output).toContain("docker-compose.yaml");
    expect(output).not.toContain("docker-compose.nvidia.yaml");
    expect(output).not.toContain("docker-compose.amd.yaml");
    expect(output).toContain("up -d --build");
  });

  it("seleciona automaticamente o overlay NVIDIA injetado", async () => {
    const output = await runLauncher({
      LOCAL_AI_DEVICE: "auto",
      SUMMYZ_DETECTED_GPU_MEMORY_BYTES: String(8 * 1_024 ** 3),
      SUMMYZ_DETECTED_GPU_NAME: "NVIDIA GeForce RTX",
      SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
    });

    expect(output).toContain("docker-compose.nvidia.yaml");
    expect(output).toContain("NVIDIA GeForce RTX");
  });

  it("seleciona NVIDIA quando nvidia-smi retorna uma única GPU", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      const executableDirectory = await createNvidiaSmiStub(fixtureRoot);
      const output = await runLauncher(
        {
          LOCAL_AI_DEVICE: "auto",
          SUMMYZ_DETECTED_GPU_NAME: "",
          SUMMYZ_DETECTED_GPU_VENDOR: "",
          ...createIsolatedPathEnvironment(executableDirectory),
        },
        fixtureRoot,
      );

      expect(output).toContain("docker-compose.nvidia.yaml");
      expect(output).toContain("NVIDIA GeForce RTX 2060");
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("trata o perfil AMD conforme o suporte do host", async () => {
    const environment = {
      LOCAL_AI_DEVICE: "auto",
      SUMMYZ_DETECTED_GPU_MEMORY_BYTES: String(8 * 1_024 ** 3),
      SUMMYZ_DETECTED_GPU_NAME: "AMD Radeon RX",
      SUMMYZ_DETECTED_GPU_VENDOR: "amd",
    };

    if (process.platform === "win32") {
      await expect(runLauncher(environment)).rejects.toThrow(
        /AMD GPU acceleration.*unavailable on Windows/i,
      );
      return;
    }

    const output = await runLauncher(environment);
    expect(output).toContain("docker-compose.amd.yaml");
    expect(output).toContain("AMD Radeon RX");
  });

  it("não aplica fallback silencioso para fabricante incompatível", async () => {
    await expect(
      runLauncher({
        LOCAL_AI_DEVICE: "auto",
        SUMMYZ_DETECTED_GPU_VENDOR: "intel",
      }),
    ).rejects.toThrow(/no supported Docker profile/i);
  });

  it("gera segredos fortes no primeiro uso sem imprimi-los", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      const output = await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot);
      const settings = parseDotEnv(await readFile(join(fixtureRoot, ".env"), "utf8"));
      const secrets = [
        settings.SUMMYZ_SECRETS_KEY,
        settings.SUMMYZ_SETUP_TOKEN,
        settings.POSTGRES_PASSWORD,
      ];

      expect(output).toContain("Created .env with random local secrets");
      expect(new Set(secrets).size).toBe(3);
      for (const secret of secrets) {
        expect(secret).toMatch(/^(?:[0-9a-f]{64}|[A-Za-z0-9_-]{43})$/);
        expect(output).not.toContain(secret);
      }
      expect(settings.DATABASE_URL).toBe(
        `postgresql://summyz_community:${settings.POSTGRES_PASSWORD}@postgres:5432/summyz-community-db`,
      );
      if (process.platform !== "win32") {
        expect((await stat(join(fixtureRoot, ".env"))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("recusa um .env existente com credenciais vazias", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      await copyFile(join(fixtureRoot, ".env.example"), join(fixtureRoot, ".env"));
      await expect(runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot)).rejects.toThrow(
        /POSTGRES_PASSWORD must contain a non-placeholder value/i,
      );
      if (process.platform !== "win32") {
        expect((await stat(join(fixtureRoot, ".env"))).mode & 0o777).toBe(0o600);
      }
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});

async function createLauncherFixture(): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "summyz-launcher-"));
  await Promise.all([
    copyFile(join(repositoryRoot, launcherName), join(fixtureRoot, launcherName)),
    copyFile(join(repositoryRoot, ".env.example"), join(fixtureRoot, ".env.example")),
  ]);
  return fixtureRoot;
}

async function createNvidiaSmiStub(fixtureRoot: string): Promise<string> {
  const executableDirectory = join(fixtureRoot, "bin");
  await mkdir(executableDirectory);
  if (process.platform === "win32") {
    await writeFile(
      join(executableDirectory, "nvidia-smi.cmd"),
      "@echo off\r\necho 0, NVIDIA GeForce RTX 2060, 6144\r\n",
    );
    return executableDirectory;
  }

  const executablePath = join(executableDirectory, "nvidia-smi");
  await writeFile(executablePath, "#!/bin/sh\nprintf '0, NVIDIA GeForce RTX 2060, 6144\\n'\n");
  await chmod(executablePath, 0o755);
  return executableDirectory;
}

function createIsolatedPathEnvironment(executableDirectory: string): NodeJS.ProcessEnv {
  const pathName = Object.keys(process.env).find((name) => name.toLowerCase() === "path") ?? "PATH";
  if (process.platform !== "win32") {
    return { [pathName]: [executableDirectory, "/usr/bin", "/bin"].join(delimiter) };
  }

  const windowsDirectory = process.env.SystemRoot;
  if (windowsDirectory === undefined) throw new Error("SystemRoot is required on Windows");
  return {
    [pathName]: [
      executableDirectory,
      join(windowsDirectory, "System32", "WindowsPowerShell", "v1.0"),
      join(windowsDirectory, "System32"),
    ].join(delimiter),
  };
}

function parseDotEnv(contents: string): Record<string, string> {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

async function runLauncher(
  environment: NodeJS.ProcessEnv,
  launcherRoot = repositoryRoot,
): Promise<string> {
  const commonEnvironment = {
    ...process.env,
    LOCAL_AI_FALLBACK: "none",
    ...environment,
  };
  if (process.platform === "win32") {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(launcherRoot, launcherName),
        "up",
        "--dry-run",
      ],
      { encoding: "utf8", env: commonEnvironment },
    );
    return result.stdout;
  }

  const result = await execFileAsync("sh", [join(launcherRoot, launcherName), "up", "--dry-run"], {
    encoding: "utf8",
    env: commonEnvironment,
  });
  return result.stdout;
}
