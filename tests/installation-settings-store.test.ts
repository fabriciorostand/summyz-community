import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationSettingsStore } from "../src/database/postgres-installation-settings-store.js";
import { SecretBox } from "../src/security/secret-box.js";

describe("PostgresInstallationSettingsStore", () => {
  const box = new SecretBox(Buffer.alloc(32, 19).toString("base64url"));

  it("stores supported installation secrets encrypted and never returns them in status", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            configured_secrets: ["discord_bot_token"],
            dashboard_language: "pt-BR",
            dashboard_theme: "system",
            discord_client_id: "client-1",
            owner_discord_user_id: null,
            setup_completed_at: null,
          },
        ],
      });
    const store = new PostgresInstallationSettingsStore({
      database: { query },
      publicBaseUrl: "http://127.0.0.1:8787",
      secretBox: box,
    });

    await store.setSecret("discord_bot_token", "real-token");
    const status = await store.getSettings();

    expect(query.mock.calls[0]?.[1]?.[1]).not.toBe("real-token");
    expect(status.secrets).toEqual({
      discordBotToken: true,
      discordClientSecret: false,
      openRouterApiKey: false,
    });
    expect(JSON.stringify(status)).not.toContain("real-token");
    expect(JSON.stringify(status)).not.toContain("smtp");
    expect(JSON.stringify(status)).not.toContain("registration");
  });

  it("decrypts a requested secret only at the backend boundary", async () => {
    const encrypted = box.encrypt("discord-secret");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ encrypted_value: encrypted }],
    });
    const store = new PostgresInstallationSettingsStore({
      database: { query },
      publicBaseUrl: "http://127.0.0.1:8787",
      secretBox: box,
    });

    await expect(store.getSecret("discord_client_secret")).resolves.toBe("discord-secret");
  });

  it("stores global dashboard preferences in installation settings", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresInstallationSettingsStore({
      database: { query },
      publicBaseUrl: "http://127.0.0.1:8787",
      secretBox: box,
    });

    await store.updatePreferences({ dashboardLanguage: "en", dashboardTheme: "dark" });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("installation_settings"), [
      "en",
      "dark",
    ]);
  });

  it("provides OAuth configuration only when all fields exist", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            configured_secrets: ["discord_client_secret"],
            dashboard_language: "pt-BR",
            dashboard_theme: "system",
            discord_client_id: "client-id",
            owner_discord_user_id: null,
            setup_completed_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ encrypted_value: box.encrypt("client-secret") }],
      });
    const store = new PostgresInstallationSettingsStore({
      database: { query },
      publicBaseUrl: "https://summyz.example.com",
      secretBox: box,
    });

    await expect(store.getDiscordOAuthConfiguration()).resolves.toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      publicBaseUrl: "https://summyz.example.com",
    });
  });
});
