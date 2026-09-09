import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresDiscordConnectionStore } from "../src/database/postgres-discord-connection-store.js";
import { SecretBox } from "../src/security/secret-box.js";

const secretBox = new SecretBox(Buffer.alloc(32, 9).toString("base64url"));

describe("PostgresDiscordConnectionStore", () => {
  it("consome estado OAuth uma única vez e recupera o verifier criptografado", async () => {
    const encryptedVerifier = secretBox.encrypt("verifier-123");
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            encrypted_code_verifier: encryptedVerifier,
            initiator_discord_user_id: null,
            intent: "setup",
            redirect_uri: "http://local/callback",
          },
        ],
      });
    const store = new PostgresDiscordConnectionStore({ database: { query }, secretBox });

    await store.createOAuthState({
      codeVerifier: "verifier-123",
      expiresAt: "2026-08-28T00:00:00.000Z",
      initiatorDiscordUserId: null,
      intent: "setup",
      redirectUri: "http://local/callback",
      stateHash: "hash",
    });
    await expect(
      store.consumeOAuthState({
        now: "2026-08-27T00:00:00.000Z",
        stateHash: "hash",
      }),
    ).resolves.toEqual({
      codeVerifier: "verifier-123",
      initiatorDiscordUserId: null,
      intent: "setup",
      redirectUri: "http://local/callback",
    });

    expect(query.mock.calls[1]?.[0]).toMatch(/UPDATE discord_oauth_states/i);
    expect(query.mock.calls[1]?.[0]).toMatch(/consumed_at IS NULL/i);
  });

  it("salva credenciais OAuth criptografadas sem incluir tokens nos parâmetros SQL", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ owner_discord_user_id: "discord-1" }],
    });
    const store = new PostgresDiscordConnectionStore({ database: { query }, secretBox });

    await store.replaceConnection(
      {
        credentials: {
          accessToken: "access-sensitive",
          expiresAt: "2026-08-28T00:00:00.000Z",
          refreshToken: "refresh-sensitive",
          scope: "identify guilds",
        },
        discordAvatar: null,
        discordUserId: "discord-1",
        discordUsername: "fabricio",
      },
      { allowAnyOwner: false, expectedOwnerDiscordUserId: null },
    );

    const values = query.mock.calls[0]?.[1] ?? [];
    expect(JSON.stringify(values)).not.toContain("access-sensitive");
    expect(JSON.stringify(values)).not.toContain("refresh-sensitive");
  });
});
