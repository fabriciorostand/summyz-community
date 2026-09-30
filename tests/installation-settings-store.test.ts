import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationSettingsStore } from "../src/database/postgres-installation-settings-store.js";
import { SecretBox } from "../src/security/secret-box.js";

describe("PostgresInstallationSettingsStore", () => {
  const box = new SecretBox(Buffer.alloc(32, 19).toString("base64url"));

  it("stores only supported installation secrets encrypted", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            configured_secrets: ["discord_bot_token"],

            discord_application_id: "application-1",
            setup_completed_at: null,
          },
        ],
      });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await store.setSecret("discord_bot_token", "real-token");
    const status = await store.getSettings();

    expect(query.mock.calls[0]?.[1]?.[1]).not.toBe("real-token");
    expect(status).not.toHaveProperty("dashboardLanguage");
    expect(status).not.toHaveProperty("dashboardTheme");
    expect(query.mock.calls[1]?.[0]).not.toContain("dashboard_language");
    expect(status.secrets).toEqual({ discordBotToken: true, openRouterApiKey: false });
    expect(JSON.stringify(status)).not.toContain("real-token");
    expect(JSON.stringify(status)).not.toContain("clientSecret");
    expect(JSON.stringify(status)).not.toContain("smtp");
  });

  it("derives and stores the application id with the validated bot token", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await store.configureDiscordBot("application-1", "bot-token");

    expect(query.mock.calls[0]?.[0]).toContain("discord_application_id");
    expect(query.mock.calls[0]?.[1]?.[0]).toBe("application-1");
    expect(query.mock.calls[0]?.[1]?.[1]).not.toBe("bot-token");
  });

  it("decrypts a requested secret only at the backend boundary", async () => {
    const encrypted = box.encrypt("discord-token");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ encrypted_value: encrypted }],
    });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await expect(store.getSecret("discord_bot_token")).resolves.toBe("discord-token");
  });

  it("reads bot credentials and their version in one database snapshot", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          discord_application_id: "application-1",
          encrypted_value: box.encrypt("bot-token"),
          setup_completed_at: new Date("2026-09-29T12:00:00.000Z"),
          version: "2026-09-29 12:00:00+00",
        },
      ],
    });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await expect(store.getBotConfigurationSnapshot()).resolves.toEqual({
      discordApplicationId: "application-1",
      discordToken: "bot-token",
      setupCompleted: true,
      version: "2026-09-29 12:00:00+00",
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it("encrypts the Discord OAuth client secret for account linking", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await store.setSecret("discord_client_secret", "private-client-secret");

    expect(query.mock.calls[0]?.[1]?.[0]).toBe("discord_client_secret");
    expect(JSON.stringify(query.mock.calls)).not.toContain("private-client-secret");
  });

  it("keeps OAuth credentials on a token rotation for the same application", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async (sql) => {
      if (sql.includes("SELECT discord_application_id")) {
        return { rowCount: 1, rows: [{ discord_application_id: "application-1" }] };
      }
      if (sql.includes("SELECT encrypted_value")) {
        return { rowCount: 1, rows: [{ encrypted_value: box.encrypt("old-token") }] };
      }
      if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ blocked: false }] };
      return { rowCount: 1, rows: [] };
    });
    const database: PostgresExecutor = { query, transaction: async (action) => action({ query }) };
    const store = new PostgresInstallationSettingsStore({ database, secretBox: box });

    await expect(store.rotateDiscordBot("application-1", "new-token")).resolves.toBe("rotated");

    expect(query.mock.calls.some(([sql]) => sql.includes("pipeline_status = 'recording'"))).toBe(
      true,
    );
    expect(
      query.mock.calls.some(([sql]) => sql.includes("DELETE FROM installation_discord_connection")),
    ).toBe(false);
    expect(JSON.stringify(query.mock.calls)).not.toContain("new-token");
  });

  it("clears the old account, client secret, OAuth states and sessions for another application", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async (sql) => {
      if (sql.includes("SELECT discord_application_id")) {
        return { rowCount: 1, rows: [{ discord_application_id: "application-1" }] };
      }
      if (sql.includes("SELECT encrypted_value")) {
        return { rowCount: 1, rows: [{ encrypted_value: box.encrypt("old-token") }] };
      }
      if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ blocked: false }] };
      return { rowCount: 1, rows: [] };
    });
    const database: PostgresExecutor = { query, transaction: async (action) => action({ query }) };
    const store = new PostgresInstallationSettingsStore({ database, secretBox: box });

    await expect(store.rotateDiscordBot("application-2", "new-token")).resolves.toBe("replaced");

    const statements = query.mock.calls.map(([sql]) => sql).join("\n");
    expect(statements).toContain("pipeline_status NOT IN ('completed', 'failed')");
    expect(statements).toContain("DELETE FROM installation_discord_connection");
    expect(statements).toContain("DELETE FROM installation_oauth_states");
    expect(statements).toContain("discord_client_secret");
    expect(statements).toContain("UPDATE dashboard_sessions");
    expect(statements).not.toContain("guild_owner_approvals");
  });

  it.each([
    ["application-1", "recording", "active_recording"],
    ["application-2", "queued", "pending_meetings"],
  ])("rejects a bot change with %s while %s exists", async (applicationId, _status, reason) => {
    const query = vi.fn<PostgresExecutor["query"]>(async (sql) => {
      if (sql.includes("SELECT discord_application_id")) {
        return { rowCount: 1, rows: [{ discord_application_id: "application-1" }] };
      }
      if (sql.includes("SELECT encrypted_value")) {
        return { rowCount: 1, rows: [{ encrypted_value: box.encrypt("old-token") }] };
      }
      if (sql.includes("SELECT EXISTS")) return { rowCount: 1, rows: [{ blocked: true }] };
      return { rowCount: 1, rows: [] };
    });
    const database: PostgresExecutor = { query, transaction: async (action) => action({ query }) };
    const store = new PostgresInstallationSettingsStore({ database, secretBox: box });

    await expect(store.rotateDiscordBot(applicationId, "new-token")).rejects.toThrow(reason);
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE installation_settings"))).toBe(
      false,
    );
  });
});
