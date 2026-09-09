import { describe, expect, it, vi } from "vitest";

import { DiscordOAuthError, DiscordOAuthService } from "../src/discord/discord-oauth-service.js";

const connection = {
  credentials: {
    accessToken: "access-token",
    expiresAt: "2026-09-10T00:00:00.000Z",
    refreshToken: "refresh-token",
    scope: "identify guilds",
  },
  discordAvatar: null,
  discordUserId: "discord-user",
  discordUsername: "Fabricio",
};

describe("DiscordOAuthService", () => {
  it("starts setup OAuth with PKCE and a persisted intent", async () => {
    const repository = repositoryStub();
    const service = new DiscordOAuthService({
      fetch: vi.fn(),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      randomToken: vi.fn().mockReturnValueOnce("state-token").mockReturnValueOnce("verifier-token"),
      repository,
      settings: configuredSettings(),
    });

    const authorizationUrl = await service.createAuthorizationUrl({ intent: "setup" });
    const url = new URL(authorizationUrl);

    expect(url.searchParams.get("scope")).toBe("identify guilds");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(repository.createOAuthState).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "setup", initiatorDiscordUserId: null }),
    );
  });

  it("claims an unowned installation and returns the Discord identity", async () => {
    const repository = repositoryStub({
      consumeOAuthState: vi.fn(async () => ({
        codeVerifier: "verifier",
        initiatorDiscordUserId: null,
        intent: "setup" as const,
        redirectUri: "http://127.0.0.1:8787/api/discord/callback",
      })),
      replaceConnection: vi.fn(async () => true),
    });
    const service = new DiscordOAuthService({
      fetch: discordFetch(),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      repository,
      settings: configuredSettings(),
    });

    await expect(service.completeAuthorization("code", "state")).resolves.toMatchObject({
      discordUserId: "discord-user",
      discordUsername: "Fabricio",
    });
    expect(repository.replaceConnection).toHaveBeenCalledWith(connection, {
      allowAnyOwner: false,
      expectedOwnerDiscordUserId: null,
    });
  });

  it("rejects login from a Discord account other than the connected owner", async () => {
    const repository = repositoryStub({
      consumeOAuthState: vi.fn(async () => ({
        codeVerifier: "verifier",
        initiatorDiscordUserId: null,
        intent: "login" as const,
        redirectUri: "http://127.0.0.1:8787/api/discord/callback",
      })),
      replaceConnection: vi.fn(async () => false),
    });
    const service = new DiscordOAuthService({
      fetch: discordFetch(),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      repository,
      settings: configuredSettings(),
    });

    await expect(service.completeAuthorization("code", "state")).rejects.toEqual(
      new DiscordOAuthError("Discord account is not the installation owner"),
    );
  });

  it("allows an authenticated owner to replace the connected Discord account", async () => {
    const repository = repositoryStub({
      consumeOAuthState: vi.fn(async () => ({
        codeVerifier: "verifier",
        initiatorDiscordUserId: "old-owner",
        intent: "replace" as const,
        redirectUri: "http://127.0.0.1:8787/api/discord/callback",
      })),
      replaceConnection: vi.fn(async () => true),
    });
    const service = new DiscordOAuthService({
      fetch: discordFetch(),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
      repository,
      settings: configuredSettings(),
    });

    await service.completeAuthorization("code", "state");

    expect(repository.replaceConnection).toHaveBeenCalledWith(connection, {
      allowAnyOwner: false,
      expectedOwnerDiscordUserId: "old-owner",
    });
  });

  it("lists only owned guilds for the currently connected identity", async () => {
    const repository = repositoryStub({ getConnection: vi.fn(async () => connection) });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { icon: null, id: "owned", name: "Equipe", owner: true },
            { icon: null, id: "member", name: "Outro", owner: false },
          ]),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const service = new DiscordOAuthService({
      fetch: fetchMock,
      repository,
      settings: configuredSettings(),
    });

    await expect(service.listOwnedGuilds("discord-user", new Set(["owned"]))).resolves.toEqual([
      expect.objectContaining({ id: "owned", installed: true }),
    ]);
    await expect(service.listOwnedGuilds("other-user", new Set())).rejects.toThrow(
      "Discord account is not connected",
    );
  });
});

function repositoryStub(overrides: Record<string, unknown> = {}) {
  return {
    consumeOAuthState: vi.fn(),
    createOAuthState: vi.fn(async () => undefined),
    getConnection: vi.fn(async () => undefined),
    replaceConnection: vi.fn(async () => true),
    ...overrides,
  };
}

function configuredSettings() {
  return {
    getDiscordOAuthConfiguration: vi.fn(async () => ({
      clientId: "client-id",
      clientSecret: "client-secret",
      publicBaseUrl: "http://127.0.0.1:8787",
    })),
  };
}

function discordFetch(): typeof fetch {
  return vi.fn(async (input) => {
    if (String(input).endsWith("/oauth2/token")) {
      return new Response(
        JSON.stringify({
          access_token: "access-token",
          expires_in: 86_400,
          refresh_token: "refresh-token",
          scope: "identify guilds",
          token_type: "Bearer",
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ avatar: null, global_name: "Fabricio", id: "discord-user", username: "f" }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  }) as typeof fetch;
}
