import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL("../", import.meta.url);

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
});

async function runLauncher(environment: NodeJS.ProcessEnv): Promise<string> {
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
        new URL("summyz.ps1", repositoryRoot).pathname.slice(1),
        "up",
        "--dry-run",
      ],
      { encoding: "utf8", env: commonEnvironment },
    );
    return result.stdout;
  }

  const result = await execFileAsync(
    "sh",
    [new URL("summyz", repositoryRoot).pathname, "up", "--dry-run"],
    { encoding: "utf8", env: commonEnvironment },
  );
  return result.stdout;
}
