import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { readContainerResources } from "../src/local-ai/container-hardware-detection.js";
import { initializeHardwareRuntime } from "../src/local-ai/hardware-runtime.js";
import type { HardwareSnapshot } from "../src/local-ai/hardware-snapshot.js";

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("node:os", () => ({
  cpus: () => Array.from({ length: 12 }, () => ({})),
  availableParallelism: () => 1,
  totalmem: () => 8 * 1024 ** 3,
}));

describe("real container resource adapter", () => {
  it("preserves fractional capacity when the bot reads API inventory and caps its own limits", async () => {
    readFile.mockImplementation(async (path: string) =>
      path.endsWith("cpu.max") ? "150000 100000" : "0-11",
    );
    let snapshot: HardwareSnapshot | undefined;
    const runtime = await initializeHardwareRuntime({
      source: "container",
      logger: pino({ level: "silent" }),
      store: {
        read: async () => snapshot,
        update: async (value) => {
          snapshot = value;
          return true;
        },
      },
      detect: async () => ({ cpuCores: 1.5, memoryBytes: 8 * 1024 ** 3, accelerators: [] }),
      readAvailability: async (value) => value,
    });
    expect(await runtime.readHardware()).toMatchObject({ cpuCores: 1.5 });
    readFile.mockImplementation(async (path: string) =>
      path.endsWith("cpu.max") ? "50000 100000" : "0-11",
    );
    expect(await runtime.readHardware()).toMatchObject({ cpuCores: 0.5 });
  });
  it("does not lose fractional quota capacity to Node's rounded available parallelism", async () => {
    readFile.mockImplementation(async (path: string) =>
      path.endsWith("cpu.max") ? "150000 100000" : "0-11",
    );
    expect(await readContainerResources()).toMatchObject({ cpuCores: 1.5 });
  });
  it("honors CPU sets and rejects malformed, overlapping, or excessive sets", async () => {
    for (const [affinity, expected] of [
      ["0-1,4,6", 4],
      ["2", 1],
    ] as const) {
      readFile.mockImplementation(async (path: string) =>
        path.endsWith("cpu.max") ? "max 100000" : affinity,
      );
      expect(await readContainerResources()).toMatchObject({ cpuCores: expected });
    }
    for (const affinity of ["", "1-0", "1,1", "0-2,2-4", "invalid", "65536"]) {
      readFile.mockImplementation(async (path: string) =>
        path.endsWith("cpu.max") ? "max 100000" : affinity,
      );
      await expect(readContainerResources()).rejects.toThrow();
    }
  });
  it("allows absent cgroup files but propagates sensor access failures", async () => {
    readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await readContainerResources()).toMatchObject({ cpuCores: 1 });
    readFile.mockRejectedValue(Object.assign(new Error("private path"), { code: "EACCES" }));
    await expect(readContainerResources()).rejects.toThrow();
  });
});
