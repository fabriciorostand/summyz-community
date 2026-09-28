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
});
