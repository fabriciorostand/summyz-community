import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationDiscordConnectionStore } from "../src/database/postgres-installation-discord-connection-store.js";
import { SecretBox } from "../src/security/secret-box.js";

describe("PostgresInstallationDiscordConnectionStore", () => {
  const box = new SecretBox(Buffer.alloc(32, 23).toString("base64url"));

  it("atomically replaces account tokens and revokes every dashboard session", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const database: PostgresExecutor = {
      query,
      transaction: async (action) => action({ query }),
    };
    const store = new PostgresInstallationDiscordConnectionStore(database, box);

    await store.replaceConnection({
      accessToken: "raw-access-token",
      discordUserId: "owner-b",
      discordUsername: "Owner B",
      expiresAt: "2026-09-29T13:00:00.000Z",
      refreshToken: "raw-refresh-token",
    });

    expect(query.mock.calls[0]?.[0]).toContain("installation_discord_connection");
    expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE dashboard_sessions"))).toBe(true);
    expect(JSON.stringify(query.mock.calls)).not.toContain("raw-access-token");
    expect(JSON.stringify(query.mock.calls)).not.toContain("raw-refresh-token");
  });

  it("consumes a state only once for its browser and before expiry", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);
    await expect(
      store.consumeState({
        browserBindingHash: "browser-hash",
        now: "2026-09-29T12:00:00.000Z",
        stateHash: "state-hash",
      }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("DELETE FROM installation_oauth_states");
    expect(query.mock.calls[0]?.[0]).toContain("browser_binding_hash");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at >");
  });

  it("stores only hashes for a new OAuth state", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);
    await store.createState({
      browserBindingHash: "hashed-browser",
      expiresAt: "2026-09-29T12:10:00.000Z",
      stateHash: "hashed-state",
    });
    expect(query.mock.calls[0]?.[0]).toContain("DELETE FROM installation_oauth_states");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at <= now()");
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO installation_oauth_states"),
      ["hashed-state", "hashed-browser", "2026-09-29T12:10:00.000Z"],
    );
  });

  it("rejects an expired or already consumed state", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 0, rows: [] });
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);
    await expect(
      store.consumeState({
        browserBindingHash: "hashed-browser",
        now: "2026-09-29T12:00:00.000Z",
        stateHash: "hashed-state",
      }),
    ).resolves.toBe(false);
  });

  it("decrypts the linked account but returns nothing when no account exists", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            discord_user_id: "owner-a",
            discord_username: "Owner A",
            encrypted_access_token: box.encrypt("access-token"),
            encrypted_refresh_token: box.encrypt("refresh-token"),
            generation: 2,
            token_expires_at: new Date("2026-09-29T13:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            discord_user_id: "owner-a",
            discord_username: "Owner A",
            encrypted_access_token: box.encrypt("access-token"),
            encrypted_refresh_token: box.encrypt("refresh-token"),
            generation: 2,
            token_expires_at: "2026-09-29T13:00:00.000Z",
          },
        ],
      });
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);

    await expect(store.getConnection()).resolves.toBeUndefined();
    await expect(store.getConnection()).resolves.toMatchObject({
      accessToken: "access-token",
      expiresAt: "2026-09-29T13:00:00.000Z",
      generation: 2,
      refreshToken: "refresh-token",
    });
    await expect(store.getConnection()).resolves.toMatchObject({
      expiresAt: "2026-09-29T13:00:00.000Z",
    });
  });

  it("requires a transaction to rotate linked identity and revoke sessions", async () => {
    const query = vi.fn<PostgresExecutor["query"]>();
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);
    await expect(
      store.replaceConnection({
        accessToken: "access-token",
        discordUserId: "owner-b",
        discordUsername: "Owner B",
        expiresAt: "2026-09-29T13:00:00.000Z",
        refreshToken: "refresh-token",
      }),
    ).rejects.toThrow("transaction is required");
    expect(query).not.toHaveBeenCalled();
  });

  it("rotates tokens only for the generation it read", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ singleton: true }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresInstallationDiscordConnectionStore({ query }, box);
    const input = {
      accessToken: "fresh-access",
      expectedGeneration: 3,
      expiresAt: "2026-09-29T13:00:00.000Z",
      refreshToken: "fresh-refresh",
    };
    await expect(store.updateTokens(input)).resolves.toBe(true);
    await expect(store.updateTokens(input)).resolves.toBe(false);
    expect(query.mock.calls[0]?.[0]).toContain("generation = $4");
    expect(JSON.stringify(query.mock.calls)).not.toContain("fresh-access");
    expect(JSON.stringify(query.mock.calls)).not.toContain("fresh-refresh");
  });
});
