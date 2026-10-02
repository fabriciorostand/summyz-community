import { Writable } from "node:stream";
import Fastify from "fastify";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import {
  deriveHardwareAgentToken,
  registerHardwareRoutes,
} from "../src/api/server-hardware-routes.js";
import { PostgresHardwareStore } from "../src/database/postgres-hardware-store.js";
import { hardwareSnapshotSchema } from "../src/local-ai/hardware-snapshot.js";

const snapshot = {
  detectedAt: "2026-10-01T12:00:00.000Z",
  platform: "win32",
  hardware: { cpuCores: 8, memoryBytes: 16 * 1024 ** 3, accelerators: [] },
};

describe("hardware events", () => {
  it("delivers changes over a stream and closes its listeners on shutdown", async () => {
    const app = Fastify();
    const update = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const key = "stream-test-key";
    registerHardwareRoutes(app, {
      secretsKey: key,
      store: { update, read: async () => undefined },
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
      await app.inject({
        method: "POST",
        url: "/api/internal/hardware",
        payload: snapshot,
        headers: { "x-summyz-hardware-token": deriveHardwareAgentToken(key) },
      });
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hardware-changed");
      expect((await app.inject("/api/local-ai/hardware")).json()).toBeNull();
      await app.inject({
        method: "POST",
        url: "/api/internal/hardware",
        payload: snapshot,
        headers: { "x-summyz-hardware-token": deriveHardwareAgentToken(key) },
      });
      await app.close();
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
    } finally {
      abort.abort();
      await app.close();
    }
  });
  it("rejects malformed, unsupported and unexpected host data", () => {
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

  it("authenticates agents before parsing reports and never logs credentials", async () => {
    const logs: string[] = [];
    const logger = pino(
      new Writable({
        write(chunk, _encoding, done) {
          logs.push(String(chunk));
          done();
        },
      }),
    );
    const update = vi.fn().mockResolvedValue(true);
    const read = vi.fn().mockResolvedValue(snapshot);
    const authorize = vi.fn().mockResolvedValue(undefined);
    const key = "private-installation-key";
    const token = deriveHardwareAgentToken(key);
    const app = Fastify();
    registerHardwareRoutes(app, { store: { update, read }, secretsKey: key, logger, authorize });
    expect(
      (await app.inject({ method: "POST", url: "/api/internal/hardware", payload: snapshot }))
        .statusCode,
    ).toBe(401);
    expect(update).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/internal/hardware",
          headers: { "x-summyz-hardware-token": token },
          payload: snapshot,
        })
      ).statusCode,
    ).toBe(204);
    expect(update).toHaveBeenCalledWith(snapshot);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/internal/hardware",
          headers: { "x-summyz-hardware-token": token },
          payload: { ...snapshot, platform: "darwin" },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject("/api/local-ai/hardware")).json()).toEqual(snapshot);
    expect(authorize).toHaveBeenCalled();
    expect(logs.join("")).not.toContain(key);
    expect(logs.join("")).not.toContain(token);
    await app.close();
  });
});
