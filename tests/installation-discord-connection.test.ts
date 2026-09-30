import { describe, expect, it, vi } from "vitest";
import {
  InstallationDiscordConnection,
  type InstallationDiscordConnectionRepository,
} from "../src/discord/installation-discord-connection.js";

const clientSecret = "private-client-secret";
const applicationId = "123456789012345678";
const baseUrl = "https://summyz.example.com";

function repository(): InstallationDiscordConnectionRepository {
  return {
    consumeState: vi.fn(async () => true),
    createState: vi.fn(async () => undefined),
    getConnection: vi.fn(async () => undefined),
    replaceConnection: vi.fn(async () => undefined),
    updateTokens: vi.fn(async () => true),
  };
}

function createService(store: InstallationDiscordConnectionRepository, fetchMock: typeof fetch) {
  return new InstallationDiscordConnection({
    applicationId: async () => applicationId,
    clientSecret: async () => clientSecret,
    fetch: fetchMock,
    now: () => new Date("2026-09-29T12:00:00.000Z"),
    publicBaseUrl: baseUrl,
    randomToken: () => "random-state-value-with-enough-entropy",
    repository: store,
  });
}

function linkedAccount(expiresAt = "2026-09-29T13:00:00.000Z") {
  return {
    accessToken: "discord-access-token",
    discordUserId: "owner-a",
    discordUsername: "Owner A",
    expiresAt,
    generation: 1,
    refreshToken: "discord-refresh-token",
  };
}

function tokenResponse(scope = "identify guilds") {
  return new Response(
    JSON.stringify({
      access_token: "new-access-token",
      expires_in: 3600,
      refresh_token: "new-refresh-token",
      scope,
      token_type: "Bearer",
    }),
    { status: 200 },
  );
}

describe("installation Discord connection", () => {
  it("binds an OAuth state to the installation browser and requests only identity and guilds", async () => {
    const store = repository();
    const service = createService(store, vi.fn<typeof fetch>());
    const url = new URL(await service.createAuthorizationUrl("browser-session"));

    expect(url.searchParams.get("scope")).toBe("identify guilds");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(store.createState).toHaveBeenCalledWith(
      expect.objectContaining({
        browserBindingHash: expect.any(String),
        stateHash: expect.any(String),
      }),
    );
    expect(JSON.stringify(vi.mocked(store.createState).mock.calls)).not.toContain(
      "browser-session",
    );
  });

  it("rejects a callback from another browser before exchanging the code", async () => {
    const store = repository();
    vi.mocked(store.consumeState).mockResolvedValue(false);
    const fetchMock = vi.fn<typeof fetch>();
    const service = createService(store, fetchMock);

    await expect(service.completeAuthorization("other-session", "code", "state")).rejects.toThrow(
      "invalid_oauth_state",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consumes a cancelled authorization without replacing the linked account", async () => {
    const store = repository();
    const fetchMock = vi.fn<typeof fetch>();
    const service = createService(store, fetchMock);

    await service.cancelAuthorization("browser-session", "state");

    expect(store.consumeState).toHaveBeenCalledOnce();
    expect(store.replaceConnection).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cancelled authorization from another browser", async () => {
    const store = repository();
    vi.mocked(store.consumeState).mockResolvedValue(false);
    const service = createService(store, vi.fn<typeof fetch>());

    await expect(service.cancelAuthorization("other-browser", "state")).rejects.toThrow(
      "invalid_oauth_state",
    );
  });

  it("replaces the account and revokes dashboard sessions after validating Discord identity", async () => {
    const store = repository();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "discord-access-token",
            expires_in: 3600,
            refresh_token: "discord-refresh-token",
            scope: "identify guilds",
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "owner-b", username: "Owner B" }), { status: 200 }),
      );
    const service = createService(store, fetchMock);

    await service.completeAuthorization("browser-session", "code", "state");

    expect(store.replaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ discordUserId: "owner-b", discordUsername: "Owner B" }),
    );
    expect(JSON.stringify(vi.mocked(store.replaceConnection).mock.calls)).not.toContain(
      clientSecret,
    );
  });

  it("lists only owned guilds using the linked user's token", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue({
      accessToken: "discord-access-token",
      discordUserId: "owner-a",
      discordUsername: "Owner A",
      expiresAt: "2026-09-29T13:00:00.000Z",
      generation: 1,
      refreshToken: "discord-refresh-token",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { icon: null, id: "guild-owned", name: "Owned", owner: true },
          { icon: null, id: "guild-member", name: "Member", owner: false },
        ]),
        { status: 200 },
      ),
    );
    const service = createService(store, fetchMock);

    await expect(service.listOwnedGuilds()).resolves.toEqual([
      { iconUrl: null, id: "guild-owned", name: "Owned" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/users/@me/guilds",
      expect.objectContaining({ headers: { authorization: "Bearer discord-access-token" } }),
    );
  });

  it("shares an in-flight guild lookup but fetches again after it completes", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount());
    let resolveGuilds: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveGuilds = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(Response.json([{ id: "guild-1", name: "Team", owner: true }]));
    const service = createService(store, fetchMock);

    const first = service.listOwnedGuilds();
    const second = service.listOwnedGuilds();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveGuilds?.(Response.json([{ id: "guild-1", name: "Team", owner: true }]));
    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ iconUrl: null, id: "guild-1", name: "Team" }],
      [{ iconUrl: null, id: "guild-1", name: "Team" }],
    ]);
    await service.listOwnedGuilds();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refreshes an expiring token only once for concurrent guild lookups", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount("2026-09-29T12:00:30.000Z"));
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/oauth2/token")
        ? tokenResponse()
        : Response.json([{ id: "guild-1", name: "Team", owner: true }]),
    );
    const service = createService(store, fetchMock);

    await expect(
      Promise.all([service.listOwnedGuilds(), service.listOwnedGuilds()]),
    ).resolves.toHaveLength(2);
    expect(store.updateTokens).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes("/oauth2/token")),
    ).toHaveLength(1);
  });

  it("reports no linked account and refuses guild access without one", async () => {
    const service = createService(repository(), vi.fn<typeof fetch>());
    await expect(service.getConnectionStatus()).resolves.toEqual({ connected: false });
    await expect(service.getConnectedUserId()).resolves.toBeNull();
    await expect(service.listOwnedGuilds()).rejects.toThrow("discord_account_not_connected");
  });

  it("reports the linked identity without exposing OAuth tokens", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount());
    const service = createService(store, vi.fn<typeof fetch>());
    await expect(service.getConnectionStatus()).resolves.toEqual({
      connected: true,
      discordUserId: "owner-a",
      discordUsername: "Owner A",
    });
    await expect(service.getConnectedUserId()).resolves.toBe("owner-a");
  });

  it("refreshes an expiring token before reading owned guilds", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount("2026-09-29T12:00:30.000Z"));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ icon: "icon-hash", id: "guild-1", name: "Team", owner: true }]),
          { status: 200 },
        ),
      );
    const service = createService(store, fetchMock);

    await expect(service.listOwnedGuilds()).resolves.toEqual([
      {
        iconUrl: "https://cdn.discordapp.com/icons/guild-1/icon-hash.png?size=128",
        id: "guild-1",
        name: "Team",
      },
    ]);
    expect(store.updateTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "new-access-token",
        expectedGeneration: 1,
      }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://discord.com/api/v10/users/@me/guilds",
      expect.objectContaining({ headers: { authorization: "Bearer new-access-token" } }),
    );
  });

  it("rejects a token refresh that races with account replacement", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount("2026-09-29T12:00:30.000Z"));
    vi.mocked(store.updateTokens).mockResolvedValue(false);
    const service = createService(store, vi.fn<typeof fetch>().mockResolvedValue(tokenResponse()));

    await expect(service.listOwnedGuilds()).rejects.toThrow("discord_connection_changed");
  });

  it("rejects insufficient OAuth scope before replacing the linked account", async () => {
    const store = repository();
    const service = createService(
      store,
      vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("identify")),
    );

    await expect(service.completeAuthorization("browser", "code", "state")).rejects.toThrow(
      "discord_oauth_scope_missing",
    );
    expect(store.replaceConnection).not.toHaveBeenCalled();
  });

  it("also rejects a token with only guild access and no identity scope", async () => {
    const store = repository();
    const service = createService(
      store,
      vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("guilds")),
    );
    await expect(service.completeAuthorization("browser", "code", "state")).rejects.toThrow(
      "discord_oauth_scope_missing",
    );
    expect(store.replaceConnection).not.toHaveBeenCalled();
  });

  it("uses the Discord display name when one is available", async () => {
    const store = repository();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "owner-b",
            username: "account-name",
            global_name: "Display Name",
          }),
          { status: 200 },
        ),
      );
    await createService(store, fetchMock).completeAuthorization("browser", "code", "state");
    expect(store.replaceConnection).toHaveBeenCalledWith(
      expect.objectContaining({ discordUsername: "Display Name" }),
    );
  });

  it("fails closed when Discord rejects token or identity requests", async () => {
    const store = repository();
    const tokenFailure = createService(
      store,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    );
    await expect(tokenFailure.completeAuthorization("browser", "code", "state")).rejects.toThrow(
      "discord_oauth_unavailable",
    );
    const identityFailure = createService(
      store,
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(new Response(null, { status: 500 })),
    );
    await expect(identityFailure.completeAuthorization("browser", "code", "state")).rejects.toThrow(
      "discord_identity_unavailable",
    );
    expect(store.replaceConnection).not.toHaveBeenCalled();
  });

  it("fails closed when the linked user's guild list cannot be read", async () => {
    const store = repository();
    vi.mocked(store.getConnection).mockResolvedValue(linkedAccount());
    const service = createService(
      store,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );
    await expect(service.listOwnedGuilds()).rejects.toThrow("discord_guilds_unavailable");
  });

  it("requires the application's OAuth client secret", async () => {
    const store = repository();
    const service = new InstallationDiscordConnection({
      applicationId: async () => applicationId,
      clientSecret: async () => undefined,
      fetch: vi.fn<typeof fetch>(),
      publicBaseUrl: baseUrl,
      repository: store,
    });
    await expect(service.createAuthorizationUrl("browser")).rejects.toThrow(
      "discord_client_secret_missing",
    );
    expect(store.createState).not.toHaveBeenCalled();
  });

  it("requires a configured Discord application before creating an authorization state", async () => {
    const store = repository();
    const service = new InstallationDiscordConnection({
      applicationId: async () => null,
      clientSecret: async () => clientSecret,
      fetch: vi.fn<typeof fetch>(),
      publicBaseUrl: baseUrl,
      repository: store,
    });
    await expect(service.createAuthorizationUrl("browser")).rejects.toThrow(
      "discord_bot_not_configured",
    );
    expect(store.createState).not.toHaveBeenCalled();
  });

  it("generates a fresh authorization state with the default clock and random source", async () => {
    const store = repository();
    const service = new InstallationDiscordConnection({
      applicationId: async () => applicationId,
      clientSecret: async () => clientSecret,
      fetch: vi.fn<typeof fetch>(),
      publicBaseUrl: baseUrl,
      repository: store,
    });
    const first = new URL(await service.createAuthorizationUrl("browser"));
    const second = new URL(await service.createAuthorizationUrl("browser"));
    expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));
    expect(store.createState).toHaveBeenCalledTimes(2);
  });
});
