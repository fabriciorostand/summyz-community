import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresDashboardSessionStore } from "../src/database/postgres-dashboard-session-store.js";

describe("PostgresDashboardSessionStore", () => {
  it("creates opaque sessions without storing a raw token", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresDashboardSessionStore({ query });

    await store.createSession({
      absoluteExpiresAt: "2026-10-09T12:00:00.000Z",
      expiresAt: "2026-09-16T12:00:00.000Z",
      tokenHash: "hashed-token",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("dashboard_sessions"), [
      expect.any(String),
      "hashed-token",
      "2026-09-16T12:00:00.000Z",
      "2026-10-09T12:00:00.000Z",
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain("raw-session-token");
  });

  it("refreshes only an active session within its absolute lifetime", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          dashboard_language: "pt-BR",
          dashboard_theme: "dark",
        },
      ],
    });
    const store = new PostgresDashboardSessionStore({ query });

    await expect(
      store.findAndRefreshSession({
        expiresAt: "2026-10-09T12:00:00.000Z",
        now: "2026-09-09T12:00:00.000Z",
        tokenHash: "hashed-token",
      }),
    ).resolves.toEqual({
      dashboardLanguage: "pt-BR",
      dashboardTheme: "dark",
    });
    expect(query.mock.calls[0]?.[0]).toContain("installation_settings");
    expect(query.mock.calls[0]?.[0]).toContain("absolute_expires_at");
    expect(query.mock.calls[0]?.[0]).not.toContain("discord_connections");
  });
});
