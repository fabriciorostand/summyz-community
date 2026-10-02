import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  detectContainerHardware,
  readContainerResources,
} from "../src/local-ai/container-hardware-detection.js";
import { ContainerHardwareInventory } from "../src/local-ai/container-hardware-inventory.js";
import {
  type HardwareSnapshot,
  hardwareProfileSchema,
  InvalidHardwareSnapshotError,
} from "../src/local-ai/hardware-snapshot.js";

const hardware = { cpuCores: 12, memoryBytes: 8 * 1024 ** 3, accelerators: [] };
const logger = pino({ level: "silent" });

function fixture() {
  let saved: HardwareSnapshot | undefined;
  const store = {
    read: vi.fn(async () => saved),
    update: vi.fn(async (snapshot: HardwareSnapshot) => {
      saved = snapshot;
      return true;
    }),
  };
  const detect = vi.fn(async () => hardware);
  const inventory = new ContainerHardwareInventory({ store, logger, detect });
  return { store, detect, inventory };
}

describe("container hardware inventory", () => {
  it("replaces invalid inventory only after a valid detection, preserving ordering and a sanitized warning", async () => {
    const logs: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    const detectedAt = "2099-01-01T00:00:00.000Z";
    const store = {
      read: vi.fn(async () => {
        throw new InvalidHardwareSnapshotError(detectedAt);
      }),
      update: vi.fn(async () => true),
    };
    const detect = vi.fn(async () => hardware);
    const inventory = new ContainerHardwareInventory({ store, detect, logger: pino(destination) });
    expect(await inventory.initialize()).toMatchObject({ status: "current", hardware });
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ detectedAt: "2099-01-01T00:00:00.001Z", hardware }),
    );
    expect(logs.join("")).toContain("invalid_hardware_snapshot");
    expect(logs.join("")).not.toContain(detectedAt);
    store.update.mockClear();
    store.read.mockClear();
    detect.mockResolvedValueOnce({ ...hardware, cpuCores: 0 });
    await expect(inventory.initialize()).rejects.toThrow("hardware_detection_failed");
    expect(store.read).not.toHaveBeenCalled();
    expect(store.update).not.toHaveBeenCalled();
  });
  it("rejects removed GPU vendors instead of retaining an Apple compatibility parser", () => {
    expect(
      hardwareProfileSchema.safeParse({
        ...hardware,
        accelerators: [{ id: "old-gpu", name: "GPU", vendor: "apple" }],
      }).success,
    ).toBe(false);
  });
  it("uses the newer valid snapshot when another process wins the database update", async () => {
    const winning: HardwareSnapshot = {
      platform: "linux",
      detectedAt: "2026-10-02T00:00:01.000Z",
      hardware,
    };
    const store = {
      read: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(winning),
      update: vi.fn(async () => false),
    };
    const inventory = new ContainerHardwareInventory({
      store,
      logger,
      detect: async () => hardware,
    });
    expect(await inventory.initialize()).toMatchObject({
      status: "current",
      detectedAt: winning.detectedAt,
    });
    const missing = new ContainerHardwareInventory({
      store: { read: async () => undefined, update: async () => false },
      logger,
      detect: async () => hardware,
    });
    await expect(missing.read()).rejects.toThrow("hardware_inventory_unavailable");
    await expect(missing.initialize()).rejects.toThrow("hardware_detection_failed");
  });
  it("requires a valid initial reading and persists it for the bot without timers", async () => {
    const { store, detect, inventory } = fixture();
    await inventory.initialize();
    expect(store.update).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "linux", hardware }),
    );
    expect(await inventory.read()).toMatchObject({
      source: "container",
      status: "current",
      hardware,
    });
    await inventory.read();
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("fails initialization instead of silently accepting invalid or unavailable resources", async () => {
    const { inventory, detect, store } = fixture();
    detect.mockRejectedValue(new Error("probe failed"));
    await expect(inventory.initialize()).rejects.toThrow("hardware_detection_failed");
    expect(store.update).not.toHaveBeenCalled();
    detect.mockResolvedValue({ ...hardware, cpuCores: 0 });
    await expect(inventory.initialize()).rejects.toThrow("hardware_detection_failed");
  });

  it("keeps the last valid inventory and detection time after failure, then clears stale state on success", async () => {
    const { inventory, detect, store } = fixture();
    await inventory.initialize();
    const previous = await store.read();
    detect.mockRejectedValueOnce(new Error("credentials and internal paths must not escape"));
    await expect(inventory.refresh()).rejects.toThrow("hardware_detection_failed");
    expect(await store.read()).toEqual(previous);
    expect(await inventory.read()).toMatchObject({
      status: "stale",
      detectedAt: previous?.detectedAt,
      hardware,
    });
    expect(store.update).toHaveBeenCalledTimes(1);
    detect.mockResolvedValue({ ...hardware, memoryBytes: 16 * 1024 ** 3 });
    await inventory.refresh();
    expect(await inventory.read()).toMatchObject({
      status: "current",
      hardware: { memoryBytes: 16 * 1024 ** 3 },
    });
  });

  it("rejects overlapping manual scans and never leaks failed adapter credentials into logs", async () => {
    const logs: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    const { store } = fixture();
    let rejectProbe: (error: Error) => void = () => {
      throw new Error("Probe not started");
    };
    const inventory = new ContainerHardwareInventory({
      store,
      logger: pino(destination),
      detect: () =>
        new Promise((_resolve, reject) => {
          rejectProbe = reject;
        }),
    });
    const pending = inventory.refresh();
    await expect(inventory.refresh()).rejects.toThrow("hardware_refresh_in_progress");
    rejectProbe(new Error("Authorization: Bearer private-secret C:\\private\\path"));
    await expect(pending).rejects.toThrow("hardware_detection_failed");
    expect(logs.join("")).not.toMatch(/private-secret|private\\path|Authorization/);
  });

  it("keeps a readable stale copy when persistence becomes unavailable during a refresh", async () => {
    const { inventory, store } = fixture();
    await inventory.initialize();
    const previous = await inventory.read();
    store.read.mockRejectedValue(new Error("database credentials must not escape"));
    await expect(inventory.refresh()).rejects.toThrow("hardware_detection_failed");
    expect(await inventory.read()).toEqual({ ...previous, status: "stale" });
  });
});

describe("container resource detection", () => {
  it("recognizes available AMD ROCm without inventing its model or VRAM", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ version: "0.33.3" })));
    const options = {
      environment: {
        SUMMYZ_DETECTED_GPU_VENDOR: "amd",
        SUMMYZ_DETECTED_GPU_NAME: "Untrusted name",
        SUMMYZ_DETECTED_GPU_MEMORY_BYTES: "999",
      },
      readResources: async () => hardware,
      request,
    };
    expect(await detectContainerHardware(options)).toEqual({
      ...hardware,
      accelerators: [{ id: "amd-runtime", name: "AMD GPU", vendor: "amd" }],
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("http://ollama-gpu:11434/api/version", expect.any(Object));
    request.mockRejectedValueOnce(new Error("ROCm service absent"));
    expect(await detectContainerHardware(options)).toEqual(hardware);
    request.mockResolvedValueOnce(new Response(JSON.stringify({ version: "" })));
    await expect(detectContainerHardware(options)).rejects.toThrow();
  });
  it("honors memory and CPU quotas, including fractional CPU allocations", async () => {
    expect(
      await readContainerResources({
        cpuCores: 12,
        memoryBytes: 32 * 1024 ** 3,
        constrainedMemoryBytes: 8 * 1024 ** 3,
        readCpuLimit: async () => "150000 100000\n",
      }),
    ).toEqual({ cpuCores: 1.5, memoryBytes: 8 * 1024 ** 3 });
    expect(
      await readContainerResources({
        ...hardware,
        constrainedMemoryBytes: 0,
        readCpuLimit: async () => "max 100000",
      }),
    ).toEqual({ cpuCores: 12, memoryBytes: hardware.memoryBytes });
    await expect(
      readContainerResources({
        ...hardware,
        constrainedMemoryBytes: 0,
        readCpuLimit: async () => "invalid",
      }),
    ).rejects.toThrow();
    for (const limit of [
      "0 100000",
      "max 0",
      "999999999999999999 100000",
      "max 999999999999999999",
    ]) {
      await expect(
        readContainerResources({
          ...hardware,
          constrainedMemoryBytes: 0,
          readCpuLimit: async () => limit,
        }),
      ).rejects.toThrow();
    }
    await expect(
      readContainerResources({
        ...hardware,
        constrainedMemoryBytes: -1,
        readCpuLimit: async () => "max 100000",
      }),
    ).rejects.toThrow();
    expect(
      await readContainerResources({
        ...hardware,
        constrainedMemoryBytes: 0,
        readCpuLimit: async () => undefined,
      }),
    ).toEqual({ cpuCores: 12, memoryBytes: hardware.memoryBytes });
  });

  it("uses fresh provider data rather than injected host GPU names or memory", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        cudaDevices: 1,
        accelerators: [
          { id: "nvidia-0", name: "Current GPU", vendor: "nvidia", memoryBytes: 6 * 1024 ** 3 },
        ],
      }),
    );
    const result = await detectContainerHardware({
      environment: {
        SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
        SUMMYZ_DETECTED_GPU_NAME: "Old GPU",
        SUMMYZ_DETECTED_GPU_MEMORY_BYTES: "999999",
      },
      readResources: async () => hardware,
      request,
    });
    expect(result.accelerators).toEqual([
      { id: "nvidia-0", name: "Current GPU", vendor: "nvidia", memoryBytes: 6 * 1024 ** 3 },
    ]);
    expect(request).toHaveBeenCalledWith(
      "http://faster-whisper-gpu:8000/hardware/inventory",
      expect.any(Object),
    );
  });

  it("supports CPU-only installations without probing unsupported GPUs", async () => {
    const request = vi.fn<typeof fetch>();
    expect(
      await detectContainerHardware({
        environment: {},
        readResources: async () => hardware,
        request,
      }),
    ).toEqual(hardware);
    expect(request).not.toHaveBeenCalled();
    expect(
      await detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "intel" },
        readResources: async () => hardware,
        request,
      }),
    ).toEqual(hardware);
  });

  it("distinguishes unavailable providers from failed or invalid sensor responses", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("unavailable"));
    expect(
      await detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).toEqual(hardware);
    request.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).rejects.toThrow("gpu_inventory_unavailable");
    request
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ version: "" }));
    await expect(
      detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).rejects.toThrow();
    request
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(
      await detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).toEqual(hardware);
  });

  it("reports unknown GPU metadata when only Ollama is available, but fails malformed sensor readings", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(Response.json({ version: "0.33.3" }));
    expect(
      await detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).toMatchObject({
      accelerators: [{ id: "nvidia-runtime", name: "NVIDIA GPU", vendor: "nvidia" }],
    });
    request.mockResolvedValue(Response.json({ cudaDevices: 1, accelerators: [] }));
    await expect(
      detectContainerHardware({
        environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" },
        readResources: async () => hardware,
        request,
      }),
    ).rejects.toThrow();
  });
});
