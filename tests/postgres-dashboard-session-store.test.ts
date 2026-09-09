import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresDashboardSessionStore } from "../src/database/postgres-dashboard-session-store.js";

describe("PostgresDashboardSessionStore", () => {
  it("creates opaque sessions without storing a raw token", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresDashboardSessionStore({ query });

    await store.createSession({
      discordUserId: "123456789012345678",
      expiresAt: "2026-10-09T12:00:00.000Z",
      tokenHash: "hashed-token",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("dashboard_sessions"), [
      expect.any(String),
      "123456789012345678",
      "hashed-token",
      "2026-10-09T12:00:00.000Z",
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain("raw-session-token");
  });

  it("refreshes only a session belonging to the currently connected owner", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          dashboard_language: "pt-BR",
          dashboard_theme: "dark",
          discord_avatar: null,
          discord_user_id: "123456789012345678",
          discord_username: "Fabricio",
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
      discordAvatar: null,
      discordUserId: "123456789012345678",
      discordUsername: "Fabricio",
    });
    expect(query.mock.calls[0]?.[0]).toContain("installation_settings");
    expect(query.mock.calls[0]?.[0]).toContain("discord_connections");
  });
});
