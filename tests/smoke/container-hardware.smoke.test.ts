import { totalmem } from "node:os";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  detectContainerHardware,
  readContainerResources,
} from "../../src/local-ai/container-hardware-detection.js";

const environment = z
  .object({
    FASTER_WHISPER_HARDWARE_SMOKE_URL: z.url().optional(),
    FASTER_WHISPER_SMOKE_URL: z.url().default("http://faster-whisper:8000"),
    SMOKE_LOCAL_AI_DEVICE: z.enum(["cpu", "gpu"]).default("cpu"),
    SMOKE_CONTAINER_CPU_CORES: z.coerce.number().positive().optional(),
    SMOKE_CONTAINER_MEMORY_BYTES: z.coerce.number().int().positive().optional(),
  })
  .parse(process.env);

describe("isolated container hardware smoke", () => {
  it("reads real cgroup quotas and fresh GPU inventory without downloading or running models", async () => {
    const resources = await readContainerResources();
    expect(resources.cpuCores).toBeGreaterThan(0);
    expect(resources.memoryBytes).toBeLessThanOrEqual(totalmem());
    if (environment.SMOKE_CONTAINER_CPU_CORES !== undefined)
      expect(resources.cpuCores).toBe(environment.SMOKE_CONTAINER_CPU_CORES);
    if (environment.SMOKE_CONTAINER_MEMORY_BYTES !== undefined)
      expect(resources.memoryBytes).toBe(environment.SMOKE_CONTAINER_MEMORY_BYTES);
    const hardware = await detectContainerHardware({
      environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
      request: async (input, init) => {
        expect(input).toBe("http://faster-whisper-gpu:8000/hardware/inventory");
        const baseUrl =
          environment.FASTER_WHISPER_HARDWARE_SMOKE_URL ?? environment.FASTER_WHISPER_SMOKE_URL;
        return fetch(`${baseUrl}/hardware/inventory`, init);
      },
    });
    expect(hardware.cpuCores).toBe(resources.cpuCores);
    expect(hardware.memoryBytes).toBe(resources.memoryBytes);
    if (environment.SMOKE_LOCAL_AI_DEVICE === "gpu") {
      expect(hardware.accelerators.length).toBeGreaterThan(0);
      for (const gpu of hardware.accelerators) {
        expect(gpu.vendor).toBe("nvidia");
        expect(gpu.memoryBytes).toBeGreaterThan(0);
      }
    } else {
      expect(hardware.accelerators).toEqual([]);
    }
  });
});
