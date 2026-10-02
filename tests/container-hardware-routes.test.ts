import Fastify from "fastify";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { registerHardwareRoutes } from "../src/api/server-hardware-routes.js";
import { ContainerHardwareInventory } from "../src/local-ai/container-hardware-inventory.js";
import type { LocalHardwareProfile } from "../src/local-ai/hardware-profile.js";
import type { HardwareSnapshot } from "../src/local-ai/hardware-snapshot.js";

async function fixture(readHardware?: () => Promise<LocalHardwareProfile>) {
  let snapshot: HardwareSnapshot | undefined;
  const store = {
    read: async () => snapshot,
    update: vi.fn(async (value: HardwareSnapshot) => {
      snapshot = value;
      return true;
    }),
  };
  const detect = vi.fn(async () => ({ cpuCores: 4, memoryBytes: 8 * 1024 ** 3, accelerators: [] }));
  const logger = pino({ level: "silent" });
  const containerInventory = new ContainerHardwareInventory({ store, detect, logger });
  await containerInventory.initialize();
  const app = Fastify();
  const authorize = vi.fn(async () => undefined);
  registerHardwareRoutes(app, {
    store,
    logger,
    authorize,
    containerInventory,
    ...(readHardware === undefined ? {} : { readHardware }),
  });
  return { app, detect, store, authorize };
}

describe("manual container hardware refresh API", () => {
  it("keeps failed manual readings visible when the live resource guard also fails", async () => {
    const readHardware = vi.fn<() => Promise<LocalHardwareProfile>>(async () => {
      throw new Error("Authorization: secret-token /private/path");
    });
    const { app, detect, store } = await fixture(readHardware);
    try {
      const previous = await store.read();
      if (previous === undefined) throw new Error("Expected initialized inventory");
      readHardware.mockResolvedValueOnce({
        ...previous.hardware,
        gpuAvailability: { ollama: true },
      });
      expect((await app.inject("/api/local-ai/hardware")).json()).toMatchObject({
        status: "current",
        hardware: { gpuAvailability: { ollama: true } },
      });
      detect.mockRejectedValueOnce(new Error("sensor unavailable"));
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(503);
      const response = await app.inject("/api/local-ai/hardware");
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        source: "container",
        status: "stale",
        detectedAt: previous?.detectedAt,
        hardware: previous?.hardware,
      });
      expect(response.body).not.toMatch(/secret-token|private|Authorization/);
    } finally {
      await app.close();
    }
  });
  it("returns a conflict during an active refresh without cancelling it", async () => {
    const { app, detect } = await fixture();
    let rejectProbe: (error: Error) => void = () => {
      throw new Error("Probe not started");
    };
    detect.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectProbe = reject;
        }),
    );
    try {
      const pending = app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" });
      await vi.waitFor(() => expect(detect).toHaveBeenCalledTimes(2));
      const conflict = await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({ error: "hardware_refresh_in_progress" });
      rejectProbe(new Error("sensor failed"));
      expect((await pending).statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it("keeps manual refresh disabled for the existing host inventory strategy", async () => {
    const app = Fastify();
    registerHardwareRoutes(app, {
      store: { read: async () => undefined, update: async () => false },
      logger: pino({ level: "silent" }),
      authorize: async () => undefined,
    });
    try {
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it("redetects only on authenticated POST requests and returns current metadata", async () => {
    const { app, detect, authorize } = await fixture();
    try {
      expect((await app.inject("/api/local-ai/hardware")).json()).toMatchObject({
        source: "container",
        status: "current",
      });
      expect(detect).toHaveBeenCalledTimes(1);
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(200);
      expect(detect).toHaveBeenCalledTimes(2);
      authorize.mockRejectedValueOnce(
        Object.assign(new Error("authentication_required"), { statusCode: 401 }),
      );
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(401);
      expect(detect).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("returns a sanitized error with the last valid reading marked stale", async () => {
    const { app, detect, store } = await fixture();
    try {
      const previous = await store.read();
      detect.mockRejectedValueOnce(new Error("Authorization: sensitive-token C:\\private\\audio"));
      const response = await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "hardware_detection_failed",
        inventory: {
          source: "container",
          status: "stale",
          detectedAt: previous?.detectedAt,
          hardware: previous?.hardware,
        },
      });
      expect(response.body).not.toMatch(/sensitive-token|private|Authorization/);
      expect((await app.inject("/api/local-ai/hardware")).json()).toMatchObject({
        status: "stale",
      });
      expect(await store.read()).toEqual(previous);
    } finally {
      await app.close();
    }
  });

  it("rejects old host agents and arbitrary refresh input without mutating the inventory", async () => {
    const { app, store, detect } = await fixture();
    try {
      const snapshot = await store.read();
      if (snapshot === undefined) throw new Error("Expected initialized hardware");
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/internal/hardware",
            headers: { "x-summyz-hardware-token": "retired-agent-token" },
            payload: snapshot,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/local-ai/hardware/refresh",
            payload: { url: "http://other-provider" },
          })
        ).statusCode,
      ).toBe(400);
      expect(store.update).toHaveBeenCalledTimes(1);
      expect(detect).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
