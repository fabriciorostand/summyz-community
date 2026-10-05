import { describe, expect, it, vi } from "vitest";
import { DiscordRateLimitError } from "../src/discord/discord-api-fetch.js";
import {
  type ConnectedDiscordProfile,
  InstallationDiscordConnection,
  type InstallationDiscordConnectionRepository,
} from "../src/discord/installation-discord-connection.js";
import { createLogger } from "../src/logger.js";

const userId = "100000000000000000";
const otherUserId = "200000000000000000";
const avatar = "1234567890abcdef1234567890abcdef";
const avatarUrl = `https://cdn.discordapp.com/avatars/${userId}/${avatar}.png?size=128`;

function fixture(profileUpdatedAt: string | null = null) {
  let now = new Date("2026-10-05T12:00:00.000Z");
  let profile: ConnectedDiscordProfile | undefined = {
    avatarUrl: profileUpdatedAt === null ? null : avatarUrl,
    discordUserId: userId,
    discordUsername: "Saved Name",
    generation: 1,
    profileUpdatedAt,
  };
  const store: InstallationDiscordConnectionRepository = {
    consumeState: vi.fn(async () => true),
    createState: vi.fn(async () => undefined),
    getConnection: vi.fn(async () => ({
      accessToken: "private-access-token",
      discordUserId: profile?.discordUserId ?? userId,
      discordUsername: "Saved Name",
      expiresAt: "2026-10-05T13:00:00.000Z",
      generation: profile?.generation ?? 1,
      refreshToken: "private-refresh-token",
    })),
    getProfile: vi.fn(async () => profile),
    replaceConnection: vi.fn(async () => undefined),
    updateProfile: vi.fn(async (input) => {
      if (profile?.generation !== input.expectedGeneration) return false;
      profile = { ...profile, ...input };
      return true;
    }),
    updateTokens: vi.fn(async () => {
      if (profile !== undefined) profile = { ...profile, generation: profile.generation + 1 };
      return true;
    }),
  };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      avatar,
      discriminator: "0",
      global_name: "Current Name",
      id: userId,
      username: "current-user",
    }),
  );
  const logs: string[] = [];
  const logger = createLogger("warn", { write: (line) => logs.push(line) });
  const service = new InstallationDiscordConnection({
    applicationId: async () => "300000000000000000",
    clientSecret: async () => "private-client-secret",
    fetch: fetchMock,
    logger,
    now: () => now,
    publicBaseUrl: "https://summyz.example.com",
    repository: store,
  });
  return {
    fetchMock,
    logs,
    service,
    setNow: (value: string) => {
      now = new Date(value);
    },
    setProfile: (value: ConnectedDiscordProfile | undefined) => {
      profile = value;
    },
    store,
  };
}

describe("connected Discord profile", () => {
  it("loads and persists current name and avatar for an already connected account", async () => {
    const { service, store, fetchMock } = fixture();
    await expect(service.getConnectionProfile()).resolves.toEqual({
      avatarUrl,
      connected: true,
      discordUserId: userId,
      discordUsername: "Current Name",
    });
    expect(store.updateProfile).toHaveBeenCalledWith({
      avatarUrl,
      discordUserId: userId,
      discordUsername: "Current Name",
      expectedGeneration: 1,
      profileUpdatedAt: "2026-10-05T12:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://discord.com/api/v10/users/@me",
      expect.objectContaining({ headers: { authorization: "Bearer private-access-token" } }),
    );
    expect(store.replaceConnection).not.toHaveBeenCalled();
  });

  it("reuses persisted data for five minutes, including after service restart", async () => {
    const { service, store, fetchMock, setNow } = fixture("2026-10-05T12:00:00.000Z");
    setNow("2026-10-05T12:04:59.999Z");
    await expect(service.getConnectionProfile()).resolves.toMatchObject({
      avatarUrl,
      discordUsername: "Saved Name",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.getConnection).not.toHaveBeenCalled();
    setNow("2026-10-05T12:05:00.000Z");
    await expect(service.getConnectionProfile()).resolves.toMatchObject({
      discordUsername: "Current Name",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes changed names and photos after the cache expires", async () => {
    const { service, fetchMock, setNow } = fixture();
    await service.getConnectionProfile();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        id: userId,
        username: "new-user",
        global_name: null,
        avatar: `a_${avatar}`,
        discriminator: "0",
      }),
    );
    setNow("2026-10-05T12:05:00.000Z");
    await expect(service.getConnectionProfile()).resolves.toMatchObject({
      discordUsername: "new-user",
      avatarUrl: `https://cdn.discordapp.com/avatars/${userId}/a_${avatar}.gif?size=128`,
    });
  });

  it.each(["0", "1337"])(
    "returns the Discord default avatar for discriminator %s",
    async (discriminator) => {
      const { service, fetchMock } = fixture();
      fetchMock.mockResolvedValueOnce(
        Response.json({ id: userId, username: "account", avatar: null, discriminator }),
      );
      const index = discriminator === "0" ? Number((BigInt(userId) >> 22n) % 6n) : 2;
      await expect(service.getConnectionProfile()).resolves.toMatchObject({
        avatarUrl: `https://cdn.discordapp.com/embed/avatars/${index}.png`,
      });
    },
  );

  it.each([new Error("private-access-token"), new DiscordRateLimitError(10)])(
    "preserves the saved profile on a Discord failure (%s)",
    async (error) => {
      const { service, fetchMock, logs, store } = fixture("2026-10-05T11:00:00.000Z");
      fetchMock.mockRejectedValueOnce(error);
      await expect(service.getConnectionProfile()).resolves.toEqual({
        avatarUrl,
        connected: true,
        discordUserId: userId,
        discordUsername: "Saved Name",
      });
      expect(store.updateProfile).not.toHaveBeenCalled();
      expect(logs.join("")).toContain("Discord profile refresh failed");
      for (const secret of [
        "private-access-token",
        "private-refresh-token",
        "private-client-secret",
        "authorization",
      ])
        expect(logs.join("")).not.toContain(secret);
      await expect(service.getConnectionProfile()).resolves.toMatchObject({
        discordUsername: "Current Name",
      });
    },
  );

  it.each([
    { id: "../private", avatar, discriminator: "0", username: "account" },
    { id: userId, avatar: "../../private", discriminator: "0", username: "account" },
    { id: userId, avatar: null, discriminator: "wrong", username: "account" },
    { id: userId, avatar: null, discriminator: "0", username: "" },
    { id: otherUserId, avatar, discriminator: "0", username: "account" },
  ])("does not persist an invalid or mismatched Discord identity", async (payload) => {
    const { service, fetchMock, store } = fixture();
    fetchMock.mockResolvedValueOnce(Response.json(payload));
    await expect(service.getConnectionProfile()).resolves.toMatchObject({
      avatarUrl: null,
      discordUsername: "Saved Name",
    });
    expect(store.updateProfile).not.toHaveBeenCalled();
  });

  it("returns the saved name and null for a legacy account if the first lookup fails", async () => {
    const { service, fetchMock } = fixture();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(service.getConnectionProfile()).resolves.toEqual({
      avatarUrl: null,
      connected: true,
      discordUserId: userId,
      discordUsername: "Saved Name",
    });
  });

  it("closes a rejected identity response before returning the saved profile", async () => {
    const { service, fetchMock } = fixture();
    const response = new Response("unavailable", { status: 503 });
    const cancel = vi.spyOn(response.body ?? new ReadableStream(), "cancel");
    fetchMock.mockResolvedValueOnce(response);
    await service.getConnectionProfile();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns disconnected without contacting Discord", async () => {
    const { service, setProfile, fetchMock } = fixture();
    setProfile(undefined);
    await expect(service.getConnectionProfile()).resolves.toEqual({ connected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps authorization status independent from profile refresh", async () => {
    const { service, fetchMock } = fixture();
    await expect(service.getConnectionStatus()).resolves.toMatchObject({
      connected: true,
      discordUserId: userId,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token before retrieving the profile", async () => {
    const { service, store, fetchMock } = fixture();
    vi.mocked(store.getConnection).mockResolvedValueOnce({
      accessToken: "old-access",
      discordUserId: userId,
      discordUsername: "Saved Name",
      expiresAt: "2026-10-05T11:00:00.000Z",
      generation: 1,
      refreshToken: "private-refresh-token",
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        scope: "identify guilds",
        token_type: "Bearer",
      }),
    );
    await expect(service.getConnectionProfile()).resolves.toMatchObject({ avatarUrl });
    expect(store.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ expectedGeneration: 2 }),
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://discord.com/api/v10/users/@me",
      expect.objectContaining({ headers: { authorization: "Bearer new-access" } }),
    );
  });

  it("shares an in-flight profile lookup", async () => {
    const { service, fetchMock } = fixture();
    let resolveResponse: ((response: Response) => void) | undefined;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const first = service.getConnectionProfile();
    const second = service.getConnectionProfile();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    resolveResponse?.(
      Response.json({ id: userId, username: "account", avatar, discriminator: "0" }),
    );
    expect(await Promise.all([first, second])).toEqual([
      expect.objectContaining({ avatarUrl }),
      expect.objectContaining({ avatarUrl }),
    ]);
  });

  it("does not mix a former account's profile into its replacement", async () => {
    const { service, fetchMock, setProfile } = fixture();
    fetchMock.mockImplementationOnce(async () => {
      setProfile({
        avatarUrl: null,
        discordUserId: otherUserId,
        discordUsername: "Replacement",
        generation: 2,
        profileUpdatedAt: null,
      });
      return Response.json({ id: userId, username: "Old Account", avatar, discriminator: "0" });
    });
    await expect(service.getConnectionProfile()).resolves.toEqual({
      avatarUrl: null,
      connected: true,
      discordUserId: otherUserId,
      discordUsername: "Replacement",
    });
  });

  it("returns disconnected if the account is removed during refresh", async () => {
    const { service, fetchMock, setProfile } = fixture();
    fetchMock.mockImplementationOnce(async () => {
      setProfile(undefined);
      throw new Error("connection removed");
    });
    await expect(service.getConnectionProfile()).resolves.toEqual({ connected: false });
  });

  it("does not query the former account if it changes before token lookup", async () => {
    const { service, store, fetchMock } = fixture();
    vi.mocked(store.getConnection).mockResolvedValueOnce({
      accessToken: "replacement-token",
      discordUserId: otherUserId,
      discordUsername: "Replacement",
      expiresAt: "2026-10-05T13:00:00.000Z",
      generation: 2,
      refreshToken: "replacement-refresh",
    });
    await service.getConnectionProfile();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.updateProfile).not.toHaveBeenCalled();
  });

  it("preserves the profile when token renewal fails", async () => {
    const { service, store, fetchMock } = fixture("2026-10-05T11:00:00.000Z");
    vi.mocked(store.getConnection).mockResolvedValueOnce({
      accessToken: "old-access",
      discordUserId: userId,
      discordUsername: "Saved Name",
      expiresAt: "2026-10-05T11:00:00.000Z",
      generation: 1,
      refreshToken: "private-refresh-token",
    });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(service.getConnectionProfile()).resolves.toMatchObject({
      avatarUrl,
      discordUsername: "Saved Name",
    });
    expect(store.updateProfile).not.toHaveBeenCalled();
  });

  it("propagates profile persistence errors and releases the in-flight lookup", async () => {
    const { service, store, fetchMock } = fixture();
    vi.mocked(store.updateProfile).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.getConnectionProfile()).rejects.toThrow("database unavailable");
    await expect(service.getConnectionProfile()).resolves.toMatchObject({ avatarUrl });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
