import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type Profile, profileSchema, subscribeToSessionExpiry } from "./api";
import { meetingHistoryDetailSchema } from "./api-contracts";

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
          { description: "Starts recording the voice channel you are in", name: "/record" },
          { description: "Stops recording the voice channel you are in", name: "/stop" },
        ],
        id: "recording",
        label: "Recording",
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
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json([{ commands: [], id: "recording", label: "Recording" }])),
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

  it("requires an explicit default or custom mode for every prompt", () => {
    const { promptModes: _promptModes, ...withoutModes } = validProfile();

    expect(profileSchema.safeParse(withoutModes).success).toBe(false);
    expect(
      profileSchema.safeParse({
        ...validProfile(),
        promptModes: { ...validProfile().promptModes, refinement: "translated" },
      }).success,
    ).toBe(false);
  });

  it("requires the transcription language on every profile", () => {
    const profile = validProfile();
    const { language: _language, ...transcription } = profile.transcription;

    expect(profileSchema.safeParse({ ...profile, transcription }).success).toBe(false);
    expect(profileSchema.parse(profile).transcription.language).toBe("pt-BR");
  });

  it("drops the removed translation phase from profiles", () => {
    const parsed = profileSchema.parse({ ...validProfile(), translation: null });

    expect(parsed).not.toHaveProperty("translation");
  });

  it("keeps the language warning of a completed summary", () => {
    const detail = meetingHistoryDetailSchema.parse({
      ...meetingDetailPayload(),
      summary: {
        ...completedSummaryPayload(),
        languageWarning: { detectedLanguage: "glg", requestedLanguage: "pt-BR" },
      },
    });

    expect(detail.summary).toMatchObject({
      languageWarning: { detectedLanguage: "glg", requestedLanguage: "pt-BR" },
    });
  });

  it("accepts a language warning without a detected language", () => {
    const detail = meetingHistoryDetailSchema.parse({
      ...meetingDetailPayload(),
      summary: { ...completedSummaryPayload(), languageWarning: { requestedLanguage: "en" } },
    });

    expect(detail.summary).toMatchObject({ languageWarning: { requestedLanguage: "en" } });
  });

  it("rejects the removed translation cost phase", () => {
    const breakdownEntry = {
      attemptCounts: { confirmed: 1, notApplicable: 0, pending: 0, unattributed: 0 },
      confirmed: [],
      execution: "api",
      provider: "openrouter",
    };
    const detail = (phase: string) => ({
      ...meetingDetailPayload(),
      cost: {
        attemptCounts: { confirmed: 1, notApplicable: 0, pending: 0, unattributed: 0 },
        breakdown: [{ ...breakdownEntry, phase }],
        confirmed: [],
      },
    });

    expect(meetingHistoryDetailSchema.safeParse(detail("summary")).success).toBe(true);
    expect(meetingHistoryDetailSchema.safeParse(detail("translation")).success).toBe(false);
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
      setupLanguage: "en",
    });
    await api.setup(undefined, { discordBotToken: "bot-token", setupLanguage: "pt-BR" });
    await api.updateForum("guild-1", null);
    await api.updateForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
    await api.updateGuildSettings("guild-1", {
      botLanguage: "en",
      persistMeetingAudio: true,
      persistMeetingContent: false,
    });
    await api.updateProfile(validProfile());
    await api.updateRecordingPermissions("guild-1", {
      roleIds: ["role-1"],
      userIds: ["user-1"],
    });
    await api.updateSecret("openrouter_api_key", "secret");
    await api.updateSecret("discord_client_secret", "client-secret");
    await api.removeSecret("discord_client_secret");
    await api.activateGuild("guild-1");
    await api.setup(undefined, {
      discordBotToken: "bot-token",
      discordClientSecret: "client-secret",
      setupLanguage: "en",
    });

    expect(fetchMock).toHaveBeenCalledTimes(20);
    const claimedSetup = findRequest(fetchMock, "/api/setup", 0);
    expect(claimedSetup.method).toBe("POST");
    expect(claimedSetup.headers.get("content-type")).toBe("application/json");
    expect(claimedSetup.headers.get("x-summyz-setup-token")).toBe("setup-token");
    const localSetup = findRequest(fetchMock, "/api/setup", 1);
    expect(localSetup.headers.has("x-summyz-setup-token")).toBe(false);
    expect(JSON.parse(localSetup.body)).toEqual({
      discordBotToken: "bot-token",
      setupLanguage: "pt-BR",
    });
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
    expect(JSON.parse(findRequest(fetchMock, "/api/setup", 2).body)).toEqual({
      discordBotToken: "bot-token",
      discordClientSecret: "client-secret",
      setupLanguage: "en",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/installation/secrets/discord_client_secret",
      expect.objectContaining({ body: JSON.stringify({ value: "client-secret" }), method: "PUT" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/installation/secrets/discord_client_secret",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/activation",
      expect.objectContaining({ method: "POST" }),
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

  it("returns meeting exports as text, in the chosen date and time formats and zone", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Voice channel: planning"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      api.getMeetingExport("guild-1", "meeting-1", {
        dateFormat: "DD/MM/YYYY",
        timeFormat: "12h",
        timeZone: "America/Sao_Paulo",
      }),
    ).resolves.toBe("Voice channel: planning");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/meetings/meeting-1/export?dateFormat=DD%2FMM%2FYYYY&timeFormat=12h&timeZone=America%2FSao_Paulo",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("sends the browser time zone with every calendar query", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("not needed"));
    vi.stubGlobal("fetch", fetchMock);

    await api.getDashboard("guild-1", "30d", "Europe/Lisbon").catch(() => undefined);
    await api.getDashboard("guild-1", "90d", "UTC").catch(() => undefined);
    await api
      .listMeetings("guild-1", { dateFrom: "2026-09-01", page: 2 }, "Europe/Lisbon")
      .catch(() => undefined);
    await api.getMeeting("guild-1", "meeting-1", "Europe/Lisbon").catch(() => undefined);

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/guilds/guild-1/dashboard?timeZone=Europe%2FLisbon",
      "/api/guilds/guild-1/dashboard?period=90d&timeZone=UTC",
      "/api/guilds/guild-1/meetings?page=2&timeZone=Europe%2FLisbon&dateFrom=2026-09-01",
      "/api/guilds/guild-1/meetings/meeting-1?timeZone=Europe%2FLisbon",
    ]);
  });

  it("reads settings that no longer carry presentation preferences", async () => {
    const settings = {
      accessMode: "local",
      discordApplicationId: null,
      discordRedirectUri: "http://127.0.0.1:8787/api/discord/callback",
      secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: false },
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(settings)));

    await expect(api.getSettings()).resolves.toEqual(settings);
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
          applicationId: "123456789012345678",
          configured: true,
          installUrl: "https://discord.com/oauth2/authorize?client_id=123456789012345678",
        }),
      ),
    );

    await expect(api.getBotInstallation()).resolves.toEqual({
      applicationId: "123456789012345678",
      configured: true,
      installUrl: "https://discord.com/oauth2/authorize?client_id=123456789012345678",
    });
  });

  it("reads whether each server has the bot, belongs to the owner and how to install it", async () => {
    const guild = {
      activeProfile: null,
      callCount: null,
      iconUrl: null,
      id: "guild-1",
      installed: false,
      installUrl: "https://discord.com/oauth2/authorize?client_id=1&guild_id=guild-1",
      name: "Pixelforge",
      owned: true,
      summaryForum: null,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json([guild])));

    await expect(api.listGuilds()).resolves.toEqual([guild]);
  });

  it("rejects a guild list without the installation and ownership flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json([{ iconUrl: null, id: "guild-1", name: "Pixelforge" }])),
    );

    await expect(api.listGuilds()).rejects.toThrow();
  });

  it("reads the owner's Discord connection and starts its authorization", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ connected: false }))
      .mockResolvedValueOnce(
        Response.json({
          avatarUrl: "https://cdn.discordapp.com/avatars/u1/a1.png",
          connected: true,
          discordUserId: "u1",
          discordUsername: "owner",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ authorizationUrl: "https://discord.com/oauth2/authorize?state=s" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.getDiscordConnection()).resolves.toEqual({ connected: false });
    await expect(api.getDiscordConnection()).resolves.toEqual({
      avatarUrl: "https://cdn.discordapp.com/avatars/u1/a1.png",
      connected: true,
      discordUserId: "u1",
      discordUsername: "owner",
    });
    await expect(api.startDiscordConnection()).resolves.toBe(
      "https://discord.com/oauth2/authorize?state=s",
    );
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/discord/connection",
      "/api/discord/connection",
      "/api/discord/connect",
    ]);
  });

  it("accepts a connected account whose avatar was never fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          avatarUrl: null,
          connected: true,
          discordUserId: "u1",
          discordUsername: "owner",
        }),
      ),
    );
    await expect(api.getDiscordConnection()).resolves.toMatchObject({ avatarUrl: null });
  });

  it("reads the redirect URL the setup asks the owner to register", async () => {
    const status = {
      accessMode: "local",
      discordRedirectUri: "http://127.0.0.1:8787/api/discord/callback",
      passwordConfigured: false,
      setupCompleted: false,
      technicalSetupCompleted: false,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(status)));

    await expect(api.getSetupStatus()).resolves.toEqual(status);
  });
});

describe("per-stage profiles and local models", () => {
  it("accepts a hybrid profile whose stages pick their own providers", () => {
    const profile = validProfile();
    const hybrid = profileSchema.parse({
      ...profile,
      profileType: "hybrid",
      summary: {
        ...profile.summary,
        device: undefined,
        model: "google/gemini-3.7-flash",
        provider: "openrouter",
      },
    });

    expect(hybrid.profileType).toBe("hybrid");
    expect(hybrid.summary.provider).toBe("openrouter");
    expect(hybrid.transcription.provider).toBe("faster-whisper");
  });

  it("accepts the setup profile, whose stages have no provider or model yet", () => {
    const profile = validProfile();
    const empty = profileSchema.parse({
      ...profile,
      profileType: null,
      refinement: { ...profile.refinement, device: undefined, model: null, provider: null },
      summary: { ...profile.summary, device: undefined, model: null, provider: null },
      transcription: {
        interSpeechSilenceMs: 0,
        language: "auto",
        mergeMaxGapMs: 2_000,
        model: null,
        prompt: null,
        provider: null,
        vad: {
          enabled: true,
          minSilenceDurationMs: 768,
          minSpeechDurationMs: 96,
          negativeSpeechThreshold: "auto",
          speechPadMs: 96,
          threshold: 0.5,
        },
      },
    });

    expect(empty.profileType).toBeNull();
    expect(empty.transcription.provider).toBeNull();
  });

  it("rejects a provider that does not run the stage", () => {
    const profile = validProfile();

    expect(
      profileSchema.safeParse({
        ...profile,
        summary: { ...profile.summary, provider: "faster-whisper", device: "auto" },
      }).success,
    ).toBe(false);
  });

  it("lists profiles with their local model availability", async () => {
    const availability = {
      missingModels: [{ model: "qwen3:4b", phase: "summary", provider: "ollama" }],
      status: "missing_models",
      unavailableProviders: [],
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json([
            { active: true, activeServerCount: 2, availability, profile: validProfile() },
          ]),
        ),
    );

    const [item] = await api.listProfiles();

    expect(item?.availability).toEqual(availability);
    expect(item?.activeServerCount).toBe(2);
  });

  it("reads each profile's availability in the guild configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          activeProfileId: "profile-1",
          profiles: [
            {
              ...validProfile(),
              availability: { missingModels: [], status: "ready", unavailableProviders: [] },
            },
          ],
          ownerConfirmationRequired: true,
          recordingRoleIds: [],
          recordingUserIds: [],
          settings: {
            botLanguage: "pt-BR",
            persistMeetingAudio: false,
            persistMeetingContent: true,
          },
        }),
      ),
    );

    const configuration = await api.getGuildConfiguration("guild-1");

    expect(configuration.profiles[0]?.availability.status).toBe("ready");
    expect(configuration.ownerConfirmationRequired).toBe(true);
  });

  it("reads a hybrid active profile in the guild list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json([
          {
            activeProfile: { name: "Misto", profileId: "p1", profileType: "hybrid" },
            iconUrl: null,
            id: "guild-1",
            installed: true,
            installUrl: null,
            name: "Pixelforge",
            owned: true,
          },
        ]),
      ),
    );

    const [guild] = await api.listGuilds();

    expect(guild?.activeProfile?.profileType).toBe("hybrid");
  });

  it("never sends the calculated profile type when creating or updating", async () => {
    const created = { ...validProfile(), profileId: "new-id" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(created, { status: 201 }))
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { profileId: _profileId, profileType: _profileType, ...input } = validProfile();

    await expect(api.createProfile(input)).resolves.toEqual(created);
    await api.updateProfile(validProfile());

    expect(JSON.parse(findRequest(fetchMock, "/api/profiles", 0).body)).not.toHaveProperty(
      "profileType",
    );
    expect(
      JSON.parse(findRequest(fetchMock, "/api/profiles/profile-1", 0).body),
    ).not.toHaveProperty("profileType");
  });

  it("lists a model catalog for a stage, provider and optional Ollama family", async () => {
    const catalog = {
      fetchedAt: 1_790_482_294_102,
      installedModels: [{ model: "qwen3:8b", sizeBytes: 5_200_000_000 }],
      inventoryStatus: "available",
      items: [
        {
          compatibility: "above_recommended",
          family: "qwen3",
          installed: true,
          model: "qwen3:8b",
          name: "qwen3:8b",
          sizeBytes: 5_200_000_000,
        },
      ],
      phase: "summary",
      provider: "ollama",
      status: "fresh",
    };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(catalog)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listModels("summary", "ollama", "qwen3")).resolves.toEqual(catalog);
    await api.listModels("transcription", "openrouter");

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/models?phase=summary&provider=ollama&family=qwen3",
      "/api/models?phase=transcription&provider=openrouter",
    ]);
  });

  it("starts, lists and cancels local model downloads", async () => {
    const job = {
      completedBytes: 0,
      downloadId: "11111111-1111-4111-8111-111111111111",
      failureCode: null,
      model: "qwen3:8b",
      provider: "ollama",
      status: "queued",
      totalBytes: null,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(job, { status: 202 }))
      .mockResolvedValueOnce(Response.json([job]))
      .mockResolvedValueOnce(Response.json({ status: "cancelling" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.startModelDownload("summary", "ollama", "qwen3:8b")).resolves.toEqual(job);
    await expect(api.listModelDownloads()).resolves.toEqual([job]);
    await api.cancelModelDownload(job.downloadId);

    expect(JSON.parse(findRequest(fetchMock, "/api/models/downloads", 0).body)).toEqual({
      model: "qwen3:8b",
      phase: "summary",
      provider: "ollama",
    });
    expect(findRequest(fetchMock, `/api/models/downloads/${job.downloadId}/cancel`, 0).method).toBe(
      "POST",
    );
  });

  it("uninstalls a local model", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.uninstallModel("faster-whisper", "large-v3");

    const request = findRequest(fetchMock, "/api/models", 0);
    expect(request.method).toBe("DELETE");
    expect(JSON.parse(request.body)).toEqual({
      model: "large-v3",
      provider: "faster-whisper",
    });
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
    promptModes: {
      refinement: "custom",
      summaryConsolidation: "custom",
      summaryExtraction: "custom",
      transcription: "default",
    },
    name: "Perfil 1",
    profileId: "profile-1",
    profileType: "local" as const,
    refinement: {
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:1.7b",
      prompt: "Revise.",
      provider: "ollama" as const,
      device: "auto",
    },
    summary: {
      consolidationPrompt: "Consolide.",
      extractionPrompt: "Extraia.",
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:4b",
      provider: "ollama" as const,
      device: "auto",
    },
    transcription: {
      batchSize: "auto" as const,
      interSpeechSilenceMs: 0,
      language: "pt-BR" as const,
      mergeMaxGapMs: 2_000,
      model: "medium",
      prompt: null,
      provider: "faster-whisper" as const,
      device: "auto",
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
  };
}

function meetingDetailPayload() {
  return {
    aiProfile: null,
    completedAt: "2026-09-01T10:30:00.000Z",
    contentRetained: true,
    durationMs: 1_800_000,
    failureCode: null,
    meetingId: "m1",
    participants: null,
    pipelineStatus: "completed",
    rawTranscript: null,
    startedAt: "2026-09-01T10:00:00.000Z",
    summary: null,
    timeZone: "America/Sao_Paulo",
    transcript: null,
    voiceChannelName: null,
  };
}

function completedSummaryPayload() {
  return {
    decisions: [],
    discussedTopics: [],
    executiveSummary: "Resumo.",
    language: "pt-BR",
    observations: [],
    status: "completed",
    tasks: [],
  };
}
