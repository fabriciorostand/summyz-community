import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationHealthStore } from "../src/database/postgres-installation-health-store.js";

describe("PostgresInstallationHealthStore", () => {
  it("reads the previous bot heartbeat to bound restart recovery", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({
      rowCount: 1,
      rows: [{ heartbeat_at: new Date("2026-09-07T11:59:50.000Z") }],
    }));
    const store = new PostgresInstallationHealthStore({ query });

    expect(await store.getHeartbeatAt("bot-main")).toBe("2026-09-07T11:59:50.000Z");
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/heartbeat_at.*component_id/i), [
      "bot-main",
    ]);
  });

  it("reports queue and stale component heartbeats without exposing secrets", async () => {
    const responses = [
      { rows: [{ active: 1, failed: 2, oldest_pending_at: "2026-09-07T11:00:00Z", scheduled: 3 }] },
      {
        rows: [
          {
            component_id: "bot-main",
            component_type: "bot",
            details: { connected: true },
            heartbeat_at: "2026-09-07T11:59:50Z",
            status: "ready",
          },
          {
            component_id: "worker-main",
            component_type: "worker",
            details: {},
            heartbeat_at: "2026-09-07T11:58:00Z",
            status: "ready",
          },
        ],
      },
      { rows: [{ local_profiles_active: true }] },
    ];
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({
      rowCount: 1,
      ...(responses.shift() ?? { rows: [] }),
    }));
    const store = new PostgresInstallationHealthStore(
      { query },
      () => new Date("2026-09-07T12:00:00Z"),
    );

    const health = await store.getStatus();

    expect(health).toMatchObject({
      localAiRequired: true,
      queue: { active: 1, failed: 2, scheduled: 3 },
    });
    expect(health.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentType: "bot", status: "ready", stale: false }),
        expect.objectContaining({ componentType: "worker", status: "unavailable", stale: true }),
        expect.objectContaining({
          componentType: "ffmpeg",
          heartbeatAt: null,
          status: "unavailable",
        }),
        expect.objectContaining({ componentType: "ollama", status: "unavailable" }),
        expect.objectContaining({ componentType: "faster_whisper", status: "unavailable" }),
      ]),
    );
    expect(JSON.stringify(health)).not.toContain("password");
    expect(JSON.stringify(health)).not.toContain("token");
  });

  it("upserts a sanitized component heartbeat", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({ rowCount: 1, rows: [] }));
    const store = new PostgresInstallationHealthStore({ query });

    await store.writeHeartbeat({
      componentId: "ffmpeg-main",
      componentType: "ffmpeg",
      details: { libopus: true },
      status: "ready",
    });

    expect(query.mock.calls[0]?.[1]?.slice(0, 4)).toEqual([
      "ffmpeg-main",
      "ffmpeg",
      "ready",
      JSON.stringify({ libopus: true }),
    ]);
  });
});
