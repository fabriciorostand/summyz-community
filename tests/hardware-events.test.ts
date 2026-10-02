import Fastify from "fastify";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { registerHardwareRoutes } from "../src/api/server-hardware-routes.js";
import { PostgresHardwareStore } from "../src/database/postgres-hardware-store.js";
import { ContainerHardwareInventory } from "../src/local-ai/container-hardware-inventory.js";
import {
  hardwareSnapshotSchema,
  InvalidHardwareSnapshotError,
} from "../src/local-ai/hardware-snapshot.js";

const snapshot = {
  detectedAt: "2026-10-01T12:00:00.000Z",
  platform: "win32",
  hardware: { cpuCores: 8, memoryBytes: 16 * 1024 ** 3, accelerators: [] },
};

describe("hardware events", () => {
  it("does not register the retired host-report endpoint", async () => {
    const app = Fastify();
    const update = vi.fn();
    registerHardwareRoutes(app, {
      store: { read: async () => undefined, update },
      authorize: async () => undefined,
      logger: pino({ level: "silent" }),
    });
    try {
      expect(app.hasRoute({ method: "POST", url: "/api/internal/hardware" })).toBe(false);
      expect(
        (await app.inject({ method: "POST", url: "/api/internal/hardware", payload: snapshot }))
          .statusCode,
      ).toBe(404);
      expect(update).not.toHaveBeenCalled();
      expect((await app.inject("/api/local-ai/hardware")).json()).toBeNull();
    } finally {
      await app.close();
    }
  });
  it("delivers successful and failed manual refresh events and closes listeners on shutdown", async () => {
    const app = Fastify();
    const detect = vi.fn(async () => snapshot.hardware);
    const containerInventory = new ContainerHardwareInventory({
      store: { update: async () => true, read: async () => undefined },
      detect,
      logger: pino({ level: "silent" }),
    });
    await containerInventory.initialize();
    registerHardwareRoutes(app, {
      containerInventory,
      store: { update: async () => false, read: async () => undefined },
      authorize: async () => undefined,
      logger: pino({ level: "silent" }),
    });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });
    const abort = new AbortController();
    try {
      const stream = await fetch(`${url}/api/local-ai/hardware/events`, { signal: abort.signal });
      const reader = stream.body?.getReader();
      if (reader === undefined) throw new Error("Expected a hardware event stream");
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hardware-changed");
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(200);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hardware-changed");
      detect.mockRejectedValueOnce(new Error("Sensor unavailable"));
      expect(
        (await app.inject({ method: "POST", url: "/api/local-ai/hardware/refresh" })).statusCode,
      ).toBe(503);
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hardware-changed");
      await app.close();
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
    } finally {
      abort.abort();
      await app.close();
    }
  });
  it("rejects malformed, unsupported and unexpected stored data", () => {
    expect(hardwareSnapshotSchema.safeParse(snapshot).success).toBe(true);
    for (const input of [
      { ...snapshot, platform: "darwin" },
      { ...snapshot, hardware: { cpuCores: 0, memoryBytes: 1 } },
      { ...snapshot, hardware: { ...snapshot.hardware, token: "secret" } },
    ])
      expect(hardwareSnapshotSchema.safeParse(input).success).toBe(false);
  });
  it("persists updates without touching meeting data and validates stored data", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ snapshot }], rowCount: 1 });
    const store = new PostgresHardwareStore({ query });
    await store.update(hardwareSnapshotSchema.parse(snapshot));
    expect(query.mock.calls[0]?.[0]).toContain("WHERE local_hardware_snapshot.detected_at");
    expect(query.mock.calls[0]?.[0]).not.toMatch(/meetings|processing_jobs|audio|cost_attempts/);
    expect(await store.read()).toEqual(snapshot);
    query.mockResolvedValue({ rows: [{ snapshot: { hardware: {} } }], rowCount: 1 });
    await expect(store.read()).rejects.toThrow();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await store.read()).toBeUndefined();
  });
  it("identifies invalid stored inventory without exposing its content and preserves its ordering timestamp", async () => {
    const detectedAt = "2099-01-01T00:00:00.000Z";
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          snapshot: { private: "credentials-must-not-escape" },
          detected_at: new Date(detectedAt),
        },
      ],
      rowCount: 1,
    });
    const store = new PostgresHardwareStore({ query });
    await expect(store.read()).rejects.toMatchObject({
      name: "Error",
      message: "invalid_hardware_snapshot",
      detectedAt,
    });
    await expect(store.read()).rejects.toBeInstanceOf(InvalidHardwareSnapshotError);
    query.mockResolvedValue({ rows: [{ snapshot: {}, detected_at: detectedAt }], rowCount: 1 });
    await expect(store.read()).rejects.toMatchObject({ detectedAt });
    query.mockResolvedValue({ rows: [{ snapshot: {}, detected_at: "invalid" }], rowCount: 1 });
    await expect(store.read()).rejects.toThrow("invalid_hardware_snapshot_metadata");
  });
});
