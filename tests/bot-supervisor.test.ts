import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { superviseBot } from "../src/bot-supervisor.js";

describe("bot supervisor", () => {
  it("restarts after a configuration change and then propagates normal completion", async () => {
    let starts = 0;
    const exitCode = await superviseBot({
      startChild: () => {
        starts += 1;
        return spawn(process.execPath, ["-e", `process.exit(${starts === 1 ? 75 : 0})`], {
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          windowsHide: true,
        });
      },
      restartDelayMs: 0,
    });

    expect(starts).toBe(2);
    expect(exitCode).toBe(0);
  });

  it("does not restart after an ordinary bot failure", async () => {
    let starts = 0;
    const exitCode = await superviseBot({
      startChild: () => {
        starts += 1;
        return spawn(process.execPath, ["-e", "process.exit(2)"], {
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          windowsHide: true,
        });
      },
      restartDelayMs: 0,
    });

    expect(starts).toBe(1);
    expect(exitCode).toBe(2);
  });

  it("reports a child spawn failure without exposing its message", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const exitCode = await superviseBot({
        startChild: () => {
          throw new Error("sensitive spawn details");
        },
      });
      expect(exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        `${JSON.stringify({ event: "bot_child_spawn_failed", errorType: "Error" })}\n`,
      );
      expect(JSON.stringify(stderr.mock.calls)).not.toContain("sensitive spawn details");
    } finally {
      stderr.mockRestore();
    }
  });
});
