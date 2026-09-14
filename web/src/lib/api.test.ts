import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type Profile, profileSchema, subscribeToSessionExpiry } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("dashboard API client", () => {
  it("reads the access status without touching any auth route", async () => {
    const status = {
      accessMode: "public",
      authenticated: false,
      passwordConfigured: true,
      setupCompleted: true,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(status));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getAccessStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access/status",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("lists the command reference grouped the way the bot registers it", async () => {
    const reference = [
      {
        commands: [
          { description: "Inicia a gravação do canal de voz em que você está", name: "/record" },
          { description: "Encerra a gravação do canal de voz em que você está", name: "/stop" },
        ],
        label: "Gravação",
      },
    ];
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(reference));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listCommands()).resolves.toEqual(reference);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/commands",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("rejects a command reference without groups or with a group without commands", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json([])));
    await expect(api.listCommands()).rejects.toThrow();

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ commands: [], label: "Gravação" }])),
    );
    await expect(api.listCommands()).rejects.toThrow();
  });

  it("surfaces an expired session as a 401 error and notifies subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpiry(listener);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "session_expired" }), { status: 401 }),
        ),
    );

    await expect(api.listGuilds()).rejects.toEqual(new ApiError(401, "session_expired"));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not report an unlock attempt with a wrong password as an expired session", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSessionExpiry(listener);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "invalid_password" }), { status: 401 }),
        ),
    );

    await expect(api.login("wrong")).rejects.toEqual(new ApiError(401, "invalid_password"));
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("exposes the retry delay of a rate-limited unlock attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ error: "login_rate_limited" }), {
          headers: { "retry-after": "42" },
          status: 429,
        }),
      ),
    );

    const failure = await api.login("password").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: "login_rate_limited", retryAfterSeconds: 42 });
  });

  it("rejeita perfis sem as chaves de prompt exigidas pelo contrato atual", () => {
    const profile = validProfile();
    const { prompt: _prompt, ...transcription } = profile.transcription;

    expect(profileSchema.safeParse({ ...profile, transcription }).success).toBe(false);
  });

  it("serializes all mutation requests at the API boundary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.changePassword("current-password", "a much longer new password");
    await api.deleteProfile("profile-1");
    await api.login("installation password");
    await api.logout();
    await api.removeSecret("openrouter_api_key");
    await api.replaceBotToken("bot-token");
    await api.setActiveProfile("guild-1", "profile-1");
    await api.setTaskCompleted("guild-1", "task-1", true);
    await api.setup("setup-token", {
      discordBotToken: "bot-token",
      installationPassword: "installation password",
    });
    await api.setup(undefined, { discordBotToken: "bot-token" });
    await api.updateForum("guild-1", null);
    await api.updateForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
    await api.updateGuildSettings("guild-1", {
      botLanguage: "en",
      persistMeetingAudio: true,
      persistMeetingContent: false,
    });
    await api.updatePreferences("en", "dark");
    await api.updateProfile(validProfile());
    await api.updateRecordingPermissions("guild-1", {
      roleIds: ["role-1"],
      userIds: ["user-1"],
    });
    await api.updateSecret("openrouter_api_key", "secret");

    expect(fetchMock).toHaveBeenCalledTimes(17);
    const claimedSetup = findRequest(fetchMock, "/api/setup", 0);
    expect(claimedSetup.method).toBe("POST");
    expect(claimedSetup.headers.get("content-type")).toBe("application/json");
    expect(claimedSetup.headers.get("x-summyz-setup-token")).toBe("setup-token");
    const localSetup = findRequest(fetchMock, "/api/setup", 1);
    expect(localSetup.headers.has("x-summyz-setup-token")).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access/login",
      expect.objectContaining({
        body: JSON.stringify({ password: "installation password" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/access/password",
      expect.objectContaining({
        body: JSON.stringify({
          currentPassword: "current-password",
          newPassword: "a much longer new password",
        }),
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/installation/bot",
      expect.objectContaining({
        body: JSON.stringify({ discordBotToken: "bot-token" }),
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/installation/secrets/openrouter_api_key",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings/preferences",
      expect.objectContaining({
        body: JSON.stringify({ dashboardLanguage: "en", dashboardTheme: "dark" }),
        method: "PUT",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/recording-permissions",
      expect.objectContaining({
        body: JSON.stringify({ roleIds: ["role-1"], userIds: ["user-1"] }),
        method: "PUT",
      }),
    );
  });

  it("never sends the profile identifier in the update body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.updateProfile(validProfile());

    const request = findRequest(fetchMock, "/api/profiles/profile-1", 0);
    expect(JSON.parse(request.body)).not.toHaveProperty("profileId");
  });

  it("returns meeting exports as text without trying to parse JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("Voice channel: planning")),
    );

    await expect(api.getMeetingExport("guild-1", "meeting-1")).resolves.toBe(
      "Voice channel: planning",
    );
  });

  it("lists visible guild members with search and role filters", async () => {
    const page = {
      items: [
        {
          avatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
          displayName: "Alice Silva",
          joinedAt: "2026-09-08T12:00:00.000Z",
          roleIds: ["role-1"],
          userId: "user-1",
        },
      ],
      page: 2,
      pageSize: 50,
      status: "available",
      total: 51,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.listGuildMembers("guild-1", {
        page: 2,
        query: "Alice Silva",
        roleId: "role-1",
      }),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/members?page=2&query=Alice+Silva&roleId=role-1",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("lists historical call participants with an optional search query", async () => {
    const page = {
      items: [
        {
          avatarUrl: null,
          displayName: "Former member",
          userId: "user-2",
        },
      ],
      page: 3,
      pageSize: 50,
      total: 101,
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listHistoricalParticipants("guild-1", 3, "Former member")).resolves.toEqual(
      page,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/participants?page=3&query=Former+member",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("reports a stable error when the failure body cannot be parsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("gateway", { status: 502 })),
    );

    await expect(api.listGuilds()).rejects.toEqual(new ApiError(502, "request_failed"));
  });

  it("validates the bot installation link returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          applicationId: "1289443021764919306",
          configured: true,
          installUrl: "https://discord.com/oauth2/authorize?client_id=1289443021764919306",
        }),
      ),
    );

    await expect(api.getBotInstallation()).resolves.toEqual({
      applicationId: "1289443021764919306",
      configured: true,
      installUrl: "https://discord.com/oauth2/authorize?client_id=1289443021764919306",
    });
  });

  it("accepts a guild list that no longer carries installation flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json([
          {
            activeProfile: null,
            callCount: 3,
            iconUrl: null,
            id: "guild-1",
            name: "Pixelforge",
            summaryForum: null,
          },
        ]),
      ),
    );

    await expect(api.listGuilds()).resolves.toEqual([
      {
        activeProfile: null,
        callCount: 3,
        iconUrl: null,
        id: "guild-1",
        name: "Pixelforge",
        summaryForum: null,
      },
    ]);
  });
});

function findRequest(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  path: string,
  occurrence: number,
): { body: string; headers: Headers; method: string } {
  const calls = fetchMock.mock.calls.filter(([input]) => String(input) === path);
  const call = calls[occurrence];
  if (call === undefined) throw new Error(`Expected request ${String(occurrence)} to ${path}`);
  const [, init] = call;
  if (!(init?.headers instanceof Headers)) throw new Error(`Expected Headers for ${path}`);
  return { body: String(init.body), headers: init.headers, method: String(init.method) };
}

function validProfile(): Profile {
  return {
    language: "auto",
    name: "Perfil 1",
    profileId: "profile-1",
    profileType: "local" as const,
    refinement: {
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:1.7b",
      prompt: "Revise.",
      provider: "ollama" as const,
    },
    summary: {
      consolidationPrompt: "Consolide.",
      extractionPrompt: "Extraia.",
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:4b",
      provider: "ollama" as const,
    },
    transcription: {
      batchSize: "auto" as const,
      interSpeechSilenceMs: 0,
      mergeMaxGapMs: 2_000,
      model: "medium",
      prompt: null,
      provider: "faster-whisper" as const,
      vad: {
        enabled: true,
        maxSpeechDurationSeconds: "auto" as const,
        minSilenceDurationMs: "auto" as const,
        minSpeechDurationMs: 0,
        negativeSpeechThreshold: "auto" as const,
        speechPadMs: 400,
        threshold: 0.5,
      },
    },
    translation: null,
  };
}
