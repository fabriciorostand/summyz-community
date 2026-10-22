import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
it.each([true, false])(
  "requires native GPU discovery before reporting readiness (GPU: %s)",
  async (gpu) => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-ollama-gpu-"));
    const marker = join(directory, "ready");
    const script = join(directory, "ollama");
    try {
      await writeFile(
        script,
        `#!/bin/sh\nprintf '%s\\n' 'msg="vram-based default context" total_vram="${gpu ? "8.0" : "0.0"} GiB"'\n${gpu ? 'i=0; while [ ! -f "$SUMMYZ_GPU_READY_PATH" ] && [ "$i" -lt 100 ]; do i=$((i+1)); sleep 0.02; done' : "sleep 0.1"}\nif [ -f "$SUMMYZ_GPU_READY_PATH" ]; then echo ready-observed; else echo unavailable-observed; fi\nexit 0\n`,
      );
      await chmod(script, 0o755);
      const shell = process.platform === "win32" ? "C:/Program Files/Git/bin/sh.exe" : "sh";
      const result = await execute(
        shell,
        [
          "-c",
          'PATH=/usr/bin:/bin:$PATH; directory=$1; if command -v cygpath >/dev/null 2>&1; then directory=$(cygpath -u "$directory"); fi; PATH="$directory:$PATH"; export PATH; exec sh "$2"',
          "fixture",
          directory.replaceAll("\\", "/"),
          resolve("scripts/ollama-gpu-entrypoint").replaceAll("\\", "/"),
        ],
        {
          env: { ...process.env, SUMMYZ_GPU_READY_PATH: marker.replaceAll("\\", "/") },
          windowsHide: true,
        },
      );
      expect(result.stdout).toContain(gpu ? "ready-observed" : "unavailable-observed");
      await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
