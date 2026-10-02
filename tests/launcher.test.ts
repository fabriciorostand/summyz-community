import { execFile } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { SecretBox } from "../src/security/secret-box.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const launcherName = process.platform === "win32" ? "summyz-community.ps1" : "summyz-community";

describe("Community launcher", () => {
  it.skipIf(process.platform === "win32")(
    "rejects local and public macOS launchers before creating files or invoking Docker",
    async () => {
      const fixtureRoot = await createLauncherFixture();
      try {
        const bin = join(fixtureRoot, "bin");
        await mkdir(bin);
        const uname = join(bin, "uname");
        await writeFile(uname, "#!/bin/sh\necho Darwin\n");
        await chmod(uname, 0o755);
        const docker = join(bin, "docker");
        await writeFile(docker, '#!/bin/sh\ntouch "$SUMMYZ_TEST_DOCKER_MARKER"\n');
        await chmod(docker, 0o755);
        await copyFile(
          join(repositoryRoot, "summyz-community-public"),
          join(fixtureRoot, "summyz-community-public"),
        );
        const env = {
          ...process.env,
          ...createIsolatedPathEnvironment(bin),
          SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
          SUMMYZ_TEST_DOCKER_MARKER: join(fixtureRoot, "docker-called"),
        };
        for (const name of ["summyz-community", "summyz-community-public"]) {
          for (const args of [
            ["up", "--dry-run"],
            ["up"],
            ["restart"],
            ["down"],
            ["status"],
            ["logs"],
            ["recover-access"],
          ]) {
            await expect(
              execFileAsync("sh", [join(fixtureRoot, name), ...args], { env }),
            ).rejects.toThrow(/Summyz supports only Windows and Linux/);
          }
        }
        await expect(access(join(fixtureRoot, ".env"))).rejects.toThrow();
        await expect(access(join(fixtureRoot, "docker-called"))).rejects.toThrow();
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
  );
  it("passes public mode explicitly to the password recovery command", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      const output = await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot, "recover-access");

      expect(output).toContain(
        "exec dashboard node dist/api/installation-access-recovery.js --access-mode public",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("keeps generated setup and encryption secrets out of the example", async () => {
    const template = await readFile(join(repositoryRoot, ".env.example"), "utf8");

    expect(template).not.toMatch(/^SUMMYZ_(?:SECRETS_KEY|SETUP_TOKEN)=/m);
  });

  it("selects CPU without a GPU overlay", async () => {
    const output = await runLauncher({ LOCAL_AI_DEVICE: "cpu" });

    expect(output).toContain("compose.yaml");
    expect(output).not.toContain("docker/compose.nvidia.yaml");
    expect(output).not.toContain("docker/compose.amd.yaml");
    expect(output).toContain("up -d --build");
  });

  it("seleciona automaticamente o overlay NVIDIA injetado", async () => {
    const output = await runLauncher({
      LOCAL_AI_DEVICE: "auto",
      SUMMYZ_DETECTED_GPU_MEMORY_BYTES: String(8 * 1_024 ** 3),
      SUMMYZ_DETECTED_GPU_NAME: "NVIDIA GeForce RTX",
      SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
    });

    expect(output).toContain("docker/compose.nvidia.yaml");
    expect(output).toContain("NVIDIA GeForce RTX");
  });

  it("prepares optional GPU providers before starting Windows or Linux bot and API", async () => {
    for (const command of ["up", "restart"]) {
      const output = await runLauncher(
        { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        undefined,
        command,
      );
      expect(output).toContain("docker/compose.hardware.yaml");
      const commands = output.split(/\r?\n/).filter((line) => line.startsWith("Executing:"));
      const provider = commands.findIndex((line) => line.endsWith("faster-whisper-gpu"));
      const application = commands.findIndex((line) =>
        /up -d --build(?: --force-recreate)?$/.test(line),
      );
      expect(provider).toBeGreaterThanOrEqual(0);
      expect(application).toBeGreaterThan(provider);
      if (command === "restart")
        expect(commands.filter((line) => line.includes("--force-recreate"))).toHaveLength(1);
      expect(output).not.toMatch(/Hardware event detector|RunAs|registration/);
    }
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

      expect(output).toContain("docker/compose.nvidia.yaml");
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
      expect(await runLauncher(environment)).toMatch(
        /AMD GPU acceleration.*unavailable on Windows/i,
      );
      return;
    }

    const output = await runLauncher(environment);
    expect(output).toContain("docker/compose.amd.yaml");
    expect(output).toContain("AMD Radeon RX");
  });

  it("completes with CPU when the detected GPU has no compatible Docker service", async () => {
    const output = await runLauncher({ SUMMYZ_DETECTED_GPU_VENDOR: "intel" });
    expect(output).toContain("CPU instances remain available");
    expect(output).toContain("up -d --build");
    expect(output).not.toContain("compose.nvidia.yaml");
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
        expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(output).not.toContain(secret);
      }
      const key = settings.SUMMYZ_SECRETS_KEY;
      if (key === undefined) throw new Error("The launcher did not generate an encryption key");
      const secretBox = new SecretBox(key);
      expect(secretBox.decrypt(secretBox.encrypt("stored-credential"))).toBe("stored-credential");
      expect(output).not.toContain(settings.DATABASE_URL);
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

  it("generates setup and encryption secrets without template placeholders", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      const templatePath = join(fixtureRoot, ".env.example");
      const template = await readFile(templatePath, "utf8");
      await writeFile(
        templatePath,
        template.replace(/^SUMMYZ_(?:SECRETS_KEY|SETUP_TOKEN)=.*\r?\n/gm, "").trimEnd(),
      );

      await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot);

      const contents = await readFile(join(fixtureRoot, ".env"), "utf8");
      expect(contents.match(/^SUMMYZ_SECRETS_KEY=[A-Za-z0-9_-]{43}$/gm)).toHaveLength(1);
      expect(contents.match(/^SUMMYZ_SETUP_TOKEN=[A-Za-z0-9_-]{43}$/gm)).toHaveLength(1);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each(["SUMMYZ_SECRETS_KEY", "SUMMYZ_SETUP_TOKEN"])(
    "rejects an existing environment missing %s without changing it",
    async (name) => {
      const fixtureRoot = await createLauncherFixture();
      try {
        await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot);
        const environmentPath = join(fixtureRoot, ".env");
        const original = await readFile(environmentPath, "utf8");
        const incomplete = original.replace(new RegExp(`^${name}=.*\\r?\\n`, "m"), "");
        await writeFile(environmentPath, incomplete);

        await expect(runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot)).rejects.toThrow(
          new RegExp(`${name} must be set`),
        );
        expect(await readFile(environmentPath, "utf8")).toBe(incomplete);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    },
  );

  it("preserves an existing environment and its encrypted credentials on repeated startup", async () => {
    const fixtureRoot = await createLauncherFixture();
    try {
      await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot);
      const environmentPath = join(fixtureRoot, ".env");
      const original = await readFile(environmentPath, "utf8");
      const key = parseDotEnv(original).SUMMYZ_SECRETS_KEY;
      if (key === undefined) throw new Error("The launcher did not generate an encryption key");
      const ciphertext = new SecretBox(key).encrypt("stored-credential");

      const output = await runLauncher({ LOCAL_AI_DEVICE: "cpu" }, fixtureRoot);

      expect(await readFile(environmentPath, "utf8")).toBe(original);
      expect(new SecretBox(key).decrypt(ciphertext)).toBe("stored-credential");
      expect(output).not.toContain("Created .env");
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
      "@echo off\r\necho 0, NVIDIA GeForce RTX 2060\r\n",
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
  launcherRoot?: string,
  commandName = "up",
): Promise<string> {
  if (launcherRoot === undefined) {
    const fixtureRoot = await createLauncherFixture();
    try {
      return await runLauncher(environment, fixtureRoot, commandName);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
  const commonEnvironment = {
    ...process.env,
    SUMMYZ_DETECTED_GPU_VENDOR: "unknown",
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
        commandName,
        "--dry-run",
      ],
      { encoding: "utf8", env: commonEnvironment },
    );
    return result.stdout + result.stderr;
  }

  const result = await execFileAsync(
    "sh",
    [join(launcherRoot, launcherName), commandName, "--dry-run"],
    {
      encoding: "utf8",
      env: commonEnvironment,
    },
  );
  return result.stdout + result.stderr;
}
