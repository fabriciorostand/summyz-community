import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { readHardwareSource } from "../src/local-ai/container-hardware-detection.js";
import { initializeHardwareRuntime } from "../src/local-ai/hardware-runtime.js";
import type { HardwareSnapshot } from "../src/local-ai/hardware-snapshot.js";

const hardware = { cpuCores: 4, memoryBytes: 1024 ** 3, accelerators: [] };
const logger = pino({ level: "silent" });
function storeFixture() {
  let snapshot: HardwareSnapshot | undefined;
  return {
    read: vi.fn(async () => snapshot),
    update: vi.fn(async (value: HardwareSnapshot) => {
      snapshot = value;
      return true;
    }),
  };
}

describe("hardware startup boundary", () => {
  it("validates the container overlay marker and preserves host mode by default", () => {
    expect(readHardwareSource({})).toBe("host");
    expect(readHardwareSource({ SUMMYZ_HARDWARE_SOURCE: "container" })).toBe("container");
    expect(() => readHardwareSource({ SUMMYZ_HARDWARE_SOURCE: "other" })).toThrow();
  });
  it("waits for mandatory container detection on every process initialization", async () => {
    const store = storeFixture();
    const detect = vi.fn(async () => hardware);
    const runtime = await initializeHardwareRuntime({
      store,
      logger,
      source: "container",
      detect,
      readAvailability: async (value) => value,
    });
    expect(runtime.initialHardware).toEqual(hardware);
    expect(runtime.containerInventory).toBeDefined();
    expect(await runtime.readHardware()).toEqual(hardware);
    expect(detect).toHaveBeenCalledTimes(1);
    await initializeHardwareRuntime({
      store,
      logger,
      source: "container",
      detect,
      readAvailability: async (value) => value,
    });
    expect(detect).toHaveBeenCalledTimes(2);
    detect.mockRejectedValueOnce(new Error("private adapter failure"));
    await expect(
      initializeHardwareRuntime({ store, logger, source: "container", detect }),
    ).rejects.toThrow("hardware_detection_failed");
  });
  it("keeps host detection and store behavior unchanged outside container inventory mode", async () => {
    const store = storeFixture();
    const detect = vi.fn(async () => hardware);
    const runtime = await initializeHardwareRuntime({
      store,
      logger,
      source: "host",
      detect,
      readAvailability: async (value) => value,
    });
    expect(runtime.containerInventory).toBeUndefined();
    expect(store.update).not.toHaveBeenCalled();
    expect(await runtime.readHardware()).toEqual(hardware);
  });
  it("reads the updated valid snapshot for new bot assessments without rescanning or changing active work", async () => {
    const store = storeFixture();
    const detect = vi.fn(async () => hardware);
    const runtime = await initializeHardwareRuntime({
      store,
      logger,
      source: "container",
      detect,
      readAvailability: async (value) => value,
    });
    const pinned = runtime.initialHardware;
    await store.update({
      detectedAt: new Date().toISOString(),
      platform: "linux",
      hardware: { ...hardware, memoryBytes: 512 * 1024 ** 2 },
    });
    expect(await runtime.readHardware()).toMatchObject({ memoryBytes: 512 * 1024 ** 2 });
    expect(pinned).toEqual(hardware);
    expect(detect).toHaveBeenCalledTimes(1);
  });
});
