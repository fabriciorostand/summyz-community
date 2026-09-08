import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationSettingsStore } from "../src/database/postgres-installation-settings-store.js";
import { SecretBox } from "../src/security/secret-box.js";

describe("PostgresInstallationSettingsStore", () => {
  const box = new SecretBox(Buffer.alloc(32, 19).toString("base64url"));

  it("stores installation secrets encrypted and never returns them in status", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            discord_client_id: "client-1",
            public_base_url: "http://127.0.0.1:3000",
            registration_enabled: true,
            setup_completed_at: "2026-08-27T10:00:00.000Z",
            smtp_from_email: "hello@example.com",
            smtp_from_name: "Summyz Community",
            smtp_host: "smtp-relay.brevo.com",
            smtp_port: 587,
            smtp_reply_to: null,
            smtp_secure: false,
            smtp_user: "smtp-user",
            configured_secrets: ["discord_bot_token", "smtp_password"],
          },
        ],
      });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await store.setSecret("discord_bot_token", "real-token");
    const status = await store.getSettings();

    const storedValue = query.mock.calls[0]?.[1]?.[1];
    expect(storedValue).not.toBe("real-token");
    expect(status.secrets).toEqual({
      discordBotToken: true,
      discordClientSecret: false,
      openRouterApiKey: false,
      smtpPassword: true,
    });
    expect(JSON.stringify(status)).not.toContain("real-token");
  });

  it("decrypts a requested secret only at the backend boundary", async () => {
    const encrypted = box.encrypt("smtp-secret");
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ encrypted_value: encrypted }],
    });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await expect(store.getSecret("smtp_password")).resolves.toBe("smtp-secret");
  });

  it("fornece a configuração OAuth somente quando todos os campos existem", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            configured_secrets: ["discord_client_secret"],
            discord_client_id: "client-id",
            public_base_url: "http://127.0.0.1:8787",
            registration_enabled: true,
            setup_completed_at: new Date(),
            smtp_from_email: null,
            smtp_from_name: "Summyz Community",
            smtp_host: null,
            smtp_port: null,
            smtp_reply_to: null,
            smtp_secure: false,
            smtp_user: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ encrypted_value: box.encrypt("client-secret") }],
      });
    const store = new PostgresInstallationSettingsStore({ database: { query }, secretBox: box });

    await expect(store.getDiscordOAuthConfiguration()).resolves.toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      publicBaseUrl: "http://127.0.0.1:8787",
    });
  });
});
