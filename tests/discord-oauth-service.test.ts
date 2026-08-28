import { describe, expect, it, vi } from "vitest";

import { DiscordOAuthService } from "../src/discord/discord-oauth-service.js";

const userId = "00000000-0000-4000-8000-000000000001";

describe("DiscordOAuthService", () => {
  it("expõe a identidade vinculada sem consultar a API do Discord", async () => {
    const repository = {
      consumeOAuthState: vi.fn(),
      createOAuthState: vi.fn(),
      deleteConnection: vi.fn(),
      getConnection: vi.fn(async () => ({
        credentials: {
          accessToken: "access-token",
          expiresAt: "2026-08-28T00:00:00.000Z",
          refreshToken: "refresh-token",
          scope: "identify guilds",
        },
        discordAvatar: null,
        discordUserId: "discord-user",
        discordUsername: "fabricio",
        userId,
      })),
      saveConnection: vi.fn(),
    };
    const fetchMock = vi.fn<typeof fetch>();
    const service = new DiscordOAuthService({
      fetch: fetchMock,
      repository,
      settings: configuredSettings(),
    });

    await expect(service.getConnectionStatus(userId)).resolves.toEqual({
      connected: true,
      discordUsername: "fabricio",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("informa quando não existe uma conta Discord vinculada", async () => {
    const repository = {
      consumeOAuthState: vi.fn(),
      createOAuthState: vi.fn(),
      deleteConnection: vi.fn(),
      getConnection: vi.fn(async () => undefined),
      saveConnection: vi.fn(),
    };
    const service = new DiscordOAuthService({
      fetch: vi.fn(),
      repository,
      settings: configuredSettings(),
    });

    await expect(service.getConnectionStatus(userId)).resolves.toEqual({ connected: false });
  });

  it("inicia OAuth com identify, guilds e PKCE sem expor o client secret", async () => {
    const repository = {
      consumeOAuthState: vi.fn(),
      createOAuthState: vi.fn(async () => undefined),
      deleteConnection: vi.fn(),
      getConnection: vi.fn(),
      saveConnection: vi.fn(),
    };
    const service = new DiscordOAuthService({
      fetch: vi.fn(),
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      randomToken: () => "random-token",
      repository,
      settings: configuredSettings(),
    });

    const authorizationUrl = await service.createAuthorizationUrl(userId);
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify guilds");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(repository.createOAuthState).toHaveBeenCalledOnce();
  });

  it("lista apenas servidores dos quais a pessoa é dona e marca os instalados", async () => {
    const repository = {
      consumeOAuthState: vi.fn(),
      createOAuthState: vi.fn(),
      deleteConnection: vi.fn(),
      getConnection: vi.fn(async () => ({
        credentials: {
          accessToken: "access-token",
          expiresAt: "2026-08-28T00:00:00.000Z",
          refreshToken: "refresh-token",
          scope: "identify guilds",
        },
        discordAvatar: null,
        discordUserId: "discord-user",
        discordUsername: "fabricio",
        userId,
      })),
      saveConnection: vi.fn(),
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { icon: null, id: "owned-installed", name: "Equipe", owner: true },
            { icon: "hash", id: "owned-not-installed", name: "Comunidade", owner: true },
            { icon: null, id: "member", name: "Outro", owner: false },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const service = new DiscordOAuthService({
      fetch: fetchMock,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      repository,
      settings: configuredSettings(),
    });

    await expect(service.listOwnedGuilds(userId, new Set(["owned-installed"]))).resolves.toEqual([
      expect.objectContaining({ id: "owned-installed", installed: true }),
      expect.objectContaining({ id: "owned-not-installed", installed: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/users/@me/guilds",
      expect.objectContaining({ headers: { authorization: "Bearer access-token" } }),
    );
  });
});

function configuredSettings() {
  return {
    getDiscordOAuthConfiguration: vi.fn(async () => ({
      clientId: "client-id",
      clientSecret: "client-secret",
      publicBaseUrl: "http://127.0.0.1:8787",
    })),
  };
}
