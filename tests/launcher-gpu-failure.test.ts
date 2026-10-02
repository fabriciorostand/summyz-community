import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
it("completes CPU startup when one GPU provider fails and still starts the other provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "summyz-gpu-failure-"));
  try {
    const name = process.platform === "win32" ? "summyz-community.ps1" : "summyz-community";
    await copyFile(name, join(directory, name));
    await copyFile(".env.example", join(directory, ".env.example"));
    const environment = {
      ...process.env,
      SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
      SUMMYZ_DETECTED_GPU_NAME: "Fixture GPU",
    };
    let result: { stdout: string; stderr: string };
    if (process.platform === "win32") {
      await mkdir(join(directory, "scripts"));
      await writeFile(
        join(directory, "scripts/install-hardware-agent.ps1"),
        "Write-Output 'Fixture detector registration'\n",
      );
      const bootstrap = [
        "function global:docker.exe {}",
        "function global:docker {",
        "  $global:LASTEXITCODE = 0",
        "  if ($args -contains 'up' -and $args -contains 'ollama-gpu') { $global:LASTEXITCODE = 1 }",
        "}",
        "function global:Start-Process { [PSCustomObject]@{ ExitCode = 0 } }",
        "$env:SUMMYZ_PUBLIC_MODE = 'false'",
        "& (Join-Path $PSScriptRoot 'summyz-community.ps1') up",
      ].join("\n");
      await writeFile(join(directory, "bootstrap.ps1"), bootstrap);
      result = await execute(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          join(directory, "bootstrap.ps1"),
        ],
        { env: environment, windowsHide: true },
      );
    } else {
      const bin = join(directory, "bin");
      await mkdir(bin);
      const docker = join(bin, "docker");
      await writeFile(
        docker,
        "#!/bin/sh\ncase \" $* \" in *' up '*' ollama-gpu '*) exit 1 ;; esac\nexit 0\n",
      );
      await chmod(docker, 0o755);
      const uname = join(bin, "uname");
      await writeFile(uname, "#!/bin/sh\necho Darwin\n");
      await chmod(uname, 0o755);
      result = await execute("sh", [join(directory, name), "up"], {
        env: {
          ...environment,
          SUMMYZ_PUBLIC_MODE: "false",
          PATH: [bin, process.env.PATH].join(delimiter),
        },
      });
    }
    const output = result.stdout + result.stderr;
    expect(output).toContain("ollama-gpu failed to start");
    expect(output).toContain("CPU remains available");
    expect(output).toContain("--wait-timeout 90 faster-whisper-gpu");
    expect(output).toContain("stop ollama-gpu");
    expect(output).toContain("rm -f ollama-gpu");
    expect(output).not.toContain("rm -f faster-whisper-gpu");
    const settings = await readFile(join(directory, ".env"), "utf8");
    expect(settings).not.toMatch(/^LOCAL_AI_(DEVICE|FALLBACK)=/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
