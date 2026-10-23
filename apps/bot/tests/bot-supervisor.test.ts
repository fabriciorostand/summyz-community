import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { superviseBot } from "../src/bot-supervisor.js";

describe("bot supervisor", () => {
  it.each([true, false])(
    "stops its child and releases signal listeners (IPC: %s)",
    async (connected) => {
      const listeners = new Set(process.listeners("SIGTERM"));
      const child = spawn(
        process.execPath,
        [
          "-e",
          connected
            ? 'process.on("message", (message) => { if (message === "shutdown") process.exit(0); }); process.send("ready");'
            : "setInterval(() => {}, 1000);",
        ],
        {
          stdio: connected ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      const completion = superviseBot({ startChild: () => child });
      try {
        await once(child, connected ? "message" : "spawn");
        const terminate = process.listeners("SIGTERM").find((listener) => !listeners.has(listener));
        if (terminate === undefined) throw new Error("Supervisor shutdown listener unavailable");
        terminate("SIGTERM");
        await expect(completion).resolves.toBe(0);
        expect(process.listeners("SIGTERM")).toEqual([...listeners]);
      } finally {
        child.kill();
        await completion;
      }
    },
  );

  it("handles asynchronous spawn errors without logging executable paths", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(
        superviseBot({
          startChild: () =>
            spawn("summyz-missing-executable-sensitive-path", [], { windowsHide: true }),
        }),
      ).resolves.toBe(1);
      expect(JSON.stringify(stderr.mock.calls)).toContain("bot_child_spawn_failed");
      expect(JSON.stringify(stderr.mock.calls)).not.toContain("sensitive-path");
    } finally {
      stderr.mockRestore();
    }
  });

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
