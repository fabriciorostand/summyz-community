import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";
import { createInitialAiProfile } from "../src/ai-profile.js";
import { type ApiServerDependencies, createApiServer } from "../src/api/server.js";
import { SessionTokenError } from "../src/auth/jwt-session.js";
import { PostgresAiProfileStore } from "../src/database/postgres-ai-profile-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { createLogger } from "../src/logger.js";

const authenticatedUser = {
  dashboardLanguage: "pt-BR" as const,
  dashboardTheme: "system" as const,
  email: "owner@example.com",
  emailVerified: true,
  installationRole: "administrator" as const,
  userId: "00000000-0000-4000-8000-000000000001",
};

describe("API dashboard", () => {
  it("expõe o estado da conexão Discord da conta autenticada", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/discord/connection",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ connected: true, discordUsername: "fabricio" });
    expect(dependencies.discord.getConnectionStatus).toHaveBeenCalledWith(authenticatedUser.userId);
    await app.close();
  });

  it("enriches server cards with profile, forum and call count", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        activeProfile: expect.objectContaining({ name: expect.any(String) }),
        callCount: 42,
        id: "guild-installed",
        summaryForum: null,
      }),
      expect.objectContaining({
        activeProfile: null,
        callCount: null,
        id: "guild-not-installed",
      }),
    ]);
    await app.close();
  });

  it("expõe o estado do setup e rejeita token de bootstrap incorreto", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const status = await app.inject({ method: "GET", url: "/api/setup/status" });
    const rejected = await app.inject({
      headers: { "x-summyz-setup-token": "wrong" },
      method: "POST",
      payload: setupPayload(),
      url: "/api/setup",
    });

    expect(status.json()).toEqual({ registrationEnabled: true, setupCompleted: false });
    expect(rejected.statusCode).toBe(403);
    expect(dependencies.auth.createInitialAdministrator).not.toHaveBeenCalled();
    await app.close();
  });

  it("protege o dashboard com uma política de conteúdo restrita", async () => {
    const app = await createApiServer(createDependencies());

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("https://cdn.discordapp.com");
    await app.close();
  });

  it("conclui o setup e nunca devolve segredos na resposta", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      headers: { "x-summyz-setup-token": "setup-token-value" },
      method: "POST",
      payload: setupPayload(),
      url: "/api/setup",
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).not.toContain("discord-secret");
    expect(dependencies.settings.setSecret).toHaveBeenCalledWith(
      "discord_client_secret",
      "discord-secret",
    );
    expect(dependencies.settings.completeSetup).toHaveBeenCalledOnce();
    await app.close();
  });

  it("usa cookies HttpOnly para access e refresh tokens", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "POST",
      payload: { email: "owner@example.com", password: "correct horse battery" },
      url: "/api/auth/login",
    });

    expect(response.statusCode).toBe(204);
    const cookies = response.headers["set-cookie"];
    expect(cookies).toEqual(
      expect.arrayContaining([
        expect.stringContaining("summyz_access=access-token;"),
        expect.stringContaining("summyz_refresh=refresh-token;"),
      ]),
    );
    expect(JSON.stringify(cookies)).toContain("HttpOnly");
    await app.close();
  });

  it("autoriza configuração somente quando a conta é dona e o bot está instalado", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "PUT",
      payload: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-installed/settings",
    });
    const rejected = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "PUT",
      payload: {
        botLanguage: "en",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-not-installed/settings",
    });

    expect(response.statusCode).toBe(204);
    expect(rejected.statusCode).toBe(403);
    expect(dependencies.guildConfig.setGuildSettings).toHaveBeenCalledWith("guild-installed", {
      botLanguage: "pt-BR",
      persistMeetingAudio: false,
      persistMeetingContent: true,
    });
    await app.close();
  });

  it("expõe Dashboard e Histórico apenas ao proprietário e atualiza nomes do Discord", async () => {
    const dependencies = createDependencies();
    dependencies.guildDirectory.getMemberDisplayNames = vi.fn(
      async () =>
        new Map([
          ["user-1", "Ana atual"],
          ["user-2", "Bruno atual"],
        ]),
    );
    dependencies.liveMeetings.getForGuild = vi.fn(async () => ({
      guildId: "guild-installed",
      meetingId: "meeting-live",
      participants: [{ avatarUrl: null, displayName: "Bruno antigo", userId: "user-2" }],
      speakingUserIds: ["user-2"],
      updatedAt: "2026-09-07T12:00:00.000Z",
      voiceChannelId: "voice-1",
    }));
    const app = await createApiServer(dependencies);

    const dashboard = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/dashboard?period=90d",
    });
    const history = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/meetings?page=1&state=completed",
    });
    const denied = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-not-installed/dashboard",
    });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json()).toMatchObject({
      liveMeeting: {
        participants: [{ displayName: "Bruno atual", userId: "user-2" }],
        speakingUserIds: ["user-2"],
      },
      timeZone: "America/Sao_Paulo",
      topSpeakers: [{ displayName: "Ana atual", userId: "user-1" }],
    });
    expect(dependencies.analytics?.getDashboard).toHaveBeenCalledWith("guild-installed", {
      period: "90d",
      timeZone: "America/Sao_Paulo",
    });
    expect(history.statusCode).toBe(200);
    expect(dependencies.analytics?.listMeetings).toHaveBeenCalledWith(
      "guild-installed",
      expect.objectContaining({ page: 1, pageSize: 20, state: "completed" }),
    );
    expect(dependencies.analytics?.updateDisplayNames).toHaveBeenCalledWith(
      "guild-installed",
      new Map([
        ["user-1", "Ana atual"],
        ["user-2", "Bruno atual"],
      ]),
    );
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("prioriza a pesquisa direta por ID sobre os filtros do histórico", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/meetings?page=1&meetingId=meeting-1&dateFrom=2026-08-01&dateTo=2026-08-31&state=failed",
    });

    expect(response.statusCode).toBe(200);
    expect(dependencies.analytics?.listMeetings).toHaveBeenCalledWith("guild-installed", {
      meetingId: "meeting-1",
      page: 1,
      pageSize: 20,
      timeZone: "America/Sao_Paulo",
    });
    await app.close();
  });

  it("forwards channel, retention and participant filters", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/meetings?page=2&channelName=planejamento&contentRetained=true&participantUserId=user-1",
    });

    expect(response.statusCode).toBe(200);
    expect(dependencies.analytics?.listMeetings).toHaveBeenCalledWith(
      "guild-installed",
      expect.objectContaining({
        channelName: "planejamento",
        contentRetained: true,
        page: 2,
        participantUserId: "user-1",
      }),
    );
    await app.close();
  });

  it("updates synchronized preferences and changes password before clearing cookies", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const preferences = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "PUT",
      payload: { dashboardLanguage: "en", dashboardTheme: "dark" },
      url: "/api/account/preferences",
    });
    const password = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "POST",
      payload: { currentPassword: "current secure password", newPassword: "new secure password" },
      url: "/api/auth/change-password",
    });

    expect(preferences.statusCode).toBe(204);
    expect(dependencies.auth.updatePreferences).toHaveBeenCalledWith(authenticatedUser.userId, {
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });
    expect(password.statusCode).toBe(204);
    expect(dependencies.auth.changePassword).toHaveBeenCalledWith(
      authenticatedUser.userId,
      "current secure password",
      "new secure password",
    );
    expect(password.headers["set-cookie"]).toBeDefined();
    await app.close();
  });

  it("exposes installation health only to the installation administrator", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/installation/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      database: { migrationVersion: 12, status: "ready" },
      externalConfiguration: {
        openRouterConfigured: false,
        smtpConfigured: false,
      },
    });
    expect(dependencies.health.getStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("lets only the authenticated Discord guild owner toggle immutable tasks", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.tasks.list).mockResolvedValueOnce([
      {
        completedAt: null,
        completedByUserId: null,
        deadlineDate: null,
        deadlinePrecision: null,
        deadlineText: null,
        deadlineTime: null,
        deadlineTimeZone: null,
        meetingId: "meeting-1",
        overdue: false,
        ownerAvatarUrl: null,
        ownerDisplayName: "Ana antiga",
        ownerName: "Ana",
        ownerUserId: "user-1",
        taskId: "2b8dfb58-2511-4b20-a535-103ec73d87d9",
        text: "Enviar relatório",
      },
    ]);
    dependencies.guildDirectory.getMemberProfiles = vi.fn(
      async () =>
        new Map([
          [
            "user-1",
            {
              avatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
              displayName: "Ana atual",
            },
          ],
        ]),
    );
    const app = await createApiServer(dependencies);
    const taskId = "2b8dfb58-2511-4b20-a535-103ec73d87d9";

    const listed = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/tasks?completed=false",
    });
    const updated = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "PATCH",
      payload: { completed: true, text: "must be ignored" },
      url: `/api/guilds/guild-installed/tasks/${taskId}/completion`,
    });
    const denied = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "PATCH",
      payload: { completed: true },
      url: `/api/guilds/guild-not-installed/tasks/${taskId}/completion`,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject([
      {
        ownerAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
        ownerDisplayName: "Ana atual",
        ownerName: "Ana",
      },
    ]);
    expect(dependencies.tasks.list).toHaveBeenCalledWith("guild-installed", { completed: false });
    expect(updated.statusCode).toBe(204);
    expect(dependencies.tasks.setCompleted).toHaveBeenCalledWith(
      "guild-installed",
      taskId,
      authenticatedUser.userId,
      true,
    );
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("deduplica verificações concorrentes de acesso ao mesmo servidor", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const [configuration, resources] = await Promise.all([
      app.inject({
        cookies: { summyz_access: "access-token" },
        method: "GET",
        url: "/api/guilds/guild-installed/configuration",
      }),
      app.inject({
        cookies: { summyz_access: "access-token" },
        method: "GET",
        url: "/api/guilds/guild-installed/resources",
      }),
    ]);

    expect(configuration.statusCode).toBe(200);
    expect(resources.statusCode).toBe(200);
    expect(dependencies.discord.listOwnedGuilds).toHaveBeenCalledOnce();
    expect(dependencies.guildDirectory.getInstalledGuildIds).toHaveBeenCalledOnce();
    await app.close();
  });

  it("retorna os prompts persistidos sem atualização tardia", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/configuration",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profiles[0]).toMatchObject({
      refinement: { prompt: expect.stringContaining("revisor conservador") },
      summary: {
        consolidationPrompt: expect.stringContaining("idioma predominante"),
        extractionPrompt: expect.stringContaining("idioma predominante"),
      },
      transcription: { prompt: null },
    });
    expect(dependencies.aiProfiles.updateProfile).not.toHaveBeenCalled();
    await app.close();
  });

  it("expõe prompts padrão localizados para restauração no editor", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.auth.authenticate).mockResolvedValue({
      ...authenticatedUser,
      dashboardLanguage: "en",
    });
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/ai/prompts/defaults?summaryLanguage=pt-BR",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      refinement: expect.stringContaining("conservative transcript reviewer"),
      summaryExtraction: expect.stringContaining("in Brazilian Portuguese"),
      transcription: null,
    });
    await app.close();
  });

  it("cria perfis pessoais globais pela API com prompts no idioma do dashboard", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);
    const {
      profileId: _profileId,
      userId: _userId,
      ...payload
    } = createInitialAiProfile(authenticatedUser.userId, "external", "pt-BR");

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "POST",
      payload: { ...payload, name: "Novo perfil" },
      url: "/api/profiles",
    });

    expect(response.statusCode).toBe(201);
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        refinement: expect.objectContaining({
          prompt: expect.stringContaining("revisor conservador"),
        }),
      }),
    );
    await app.close();
  });

  it("lista perfis pessoais e informa apenas se cada um está ativo", async () => {
    const dependencies = createDependencies();
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/profiles",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        active: true,
        profile: expect.objectContaining({
          profileType: "external",
          userId: authenticatedUser.userId,
        }),
      }),
    ]);
    expect(dependencies.aiProfiles.ensureInitialProfiles).toHaveBeenCalledWith(
      authenticatedUser.userId,
      "pt-BR",
    );
    await app.close();
  });

  it("remove do servidor o perfil ativo que pertencia ao proprietário anterior", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.aiProfiles.getActiveProfile).mockResolvedValue(
      createInitialAiProfile("00000000-0000-4000-8000-000000000002", "external", "pt-BR"),
    );
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/configuration",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().activeProfileId).toBeNull();
    expect(dependencies.aiProfiles.clearActiveProfile).toHaveBeenCalledWith("guild-installed");
    await app.close();
  });

  it("trata JWT inválido como sessão expirada sem revelar detalhes", async () => {
    const dependencies = createDependencies();
    vi.mocked(dependencies.auth.authenticate).mockRejectedValueOnce(new SessionTokenError());
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_access: "invalid" },
      method: "GET",
      url: "/api/auth/me",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "session_expired" });
    await app.close();
  });

  it("trata perfil persistido inválido como falha interna estruturada sem vazar conteúdo", async () => {
    const profile = createInitialAiProfile(authenticatedUser.userId, "local", "pt-BR");
    const { prompt: _prompt, ...legacyTranscription } = profile.transcription;
    const legacyRow = {
      name: profile.name,
      owner_user_id: profile.userId,
      profile_id: profile.profileId,
      profile_type: profile.profileType,
      refinement: { ...profile.refinement, prompt: "super-secret-prompt" },
      summary: profile.summary,
      transcription: legacyTranscription,
    };
    const query = vi.fn<PostgresExecutor["query"]>(async (text) => {
      if (/FROM ai_profiles\s+WHERE owner_user_id/i.test(text)) {
        return { rowCount: 1, rows: [legacyRow] };
      }
      return { rowCount: 0, rows: [] };
    });
    const destination = new PassThrough();
    let logs = "";
    destination.on("data", (chunk: Buffer) => {
      logs += chunk.toString("utf8");
    });
    const dependencies = {
      ...createDependencies(),
      aiProfiles: new PostgresAiProfileStore({ query }),
      logger: createLogger("error", destination),
    };
    const app = await createApiServer(dependencies);

    const profilesResponse = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/profiles",
    });
    const configurationResponse = await app.inject({
      cookies: { summyz_access: "access-token" },
      method: "GET",
      url: "/api/guilds/guild-installed/configuration",
    });

    expect(profilesResponse.statusCode).toBe(500);
    expect(profilesResponse.json()).toEqual({ error: "internal_error" });
    expect(configurationResponse.statusCode).toBe(500);
    expect(configurationResponse.json()).toEqual({ error: "internal_error" });
    expect(logs).toContain('"errorCategory":"persisted_data"');
    expect(logs).toContain('"operation":"list_ai_profiles"');
    expect(logs).toContain('"operation":"load_guild_configuration"');
    expect(logs).not.toContain("super-secret-prompt");
    await app.close();
  });
});

function createDependencies(): ApiServerDependencies {
  const profile = createInitialAiProfile(authenticatedUser.userId, "external", "pt-BR");
  return {
    analytics: {
      getGuildCallCount: vi.fn(async () => 42),
      getDashboard: vi.fn(async () => ({
        averageDurationMs: 60_000,
        calls: { current: 1, deltaPercentage: 0, previous: 1 },
        cost: {
          attemptCounts: { confirmed: 1, notApplicable: 0, pending: 0, unattributed: 0 },
          breakdown: [],
          confirmed: [{ amount: "0.100000", currency: "USD" }],
        },
        openTaskCount: 0,
        period: "30d" as const,
        statusSeries: [],
        topSpeakers: [
          { avatarUrl: null, displayName: "Ana antiga", talkTimeMs: 60_000, userId: "user-1" },
        ],
        totalCalls: 1,
        totalDurationMs: 60_000,
      })),
      getMeeting: vi.fn(async () => undefined),
      listMeetings: vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 })),
      updateDisplayNames: vi.fn(async () => undefined),
      updateParticipantProfiles: vi.fn(async () => undefined),
    },
    aiProfiles: {
      clearActiveProfile: vi.fn(async () => undefined),
      createProfile: vi.fn(async () => undefined),
      deleteProfile: vi.fn(async () => undefined),
      ensureInitialProfiles: vi.fn(async () => undefined),
      getActiveProfile: vi.fn(async () => profile),
      getActiveProfileForDiscordOwner: vi.fn(async () => profile),
      listActiveProfileIds: vi.fn(async () => new Set([profile.profileId])),
      listActiveProfileCounts: vi.fn(async () => new Map([[profile.profileId, 1]])),
      listProfiles: vi.fn(async () => [profile]),
      setActiveProfile: vi.fn(async () => undefined),
      updateProfile: vi.fn(async () => undefined),
    },
    auth: {
      authenticate: vi.fn(async () => authenticatedUser),
      changePassword: vi.fn(async () => undefined),
      createInitialAdministrator: vi.fn(async () => ({
        ...authenticatedUser,
        passwordHash: "not-returned",
      })),
      login: vi.fn(async () => ({ accessToken: "access-token", refreshToken: "refresh-token" })),
      logout: vi.fn(async () => undefined),
      refresh: vi.fn(async () => ({ accessToken: "new-access", refreshToken: "new-refresh" })),
      register: vi.fn(async () => undefined),
      requestPasswordReset: vi.fn(async () => undefined),
      resetPassword: vi.fn(async () => undefined),
      updatePreferences: vi.fn(async () => undefined),
      verifyEmail: vi.fn(async () => undefined),
    },
    discord: {
      completeAuthorization: vi.fn(async () => undefined),
      createAuthorizationUrl: vi.fn(async () => "https://discord.com/oauth2/authorize"),
      disconnect: vi.fn(async () => undefined),
      getConnectionStatus: vi.fn(async () => ({
        connected: true as const,
        discordUsername: "fabricio",
      })),
      listOwnedGuilds: vi.fn(async () => [
        {
          iconUrl: null,
          id: "guild-installed",
          installUrl: "https://discord.com/install",
          installed: true,
          name: "Equipe",
        },
        {
          iconUrl: null,
          id: "guild-not-installed",
          installUrl: "https://discord.com/install",
          installed: false,
          name: "Comunidade",
        },
      ]),
    },
    guildConfig: {
      addRecordingRole: vi.fn(async () => undefined),
      clearSummaryForum: vi.fn(async () => undefined),
      getGuildSettings: vi.fn(async () => ({
        botLanguage: "en" as const,
        persistMeetingAudio: false,
        persistMeetingContent: true,
      })),
      getSummaryForum: vi.fn(async () => undefined),
      listRecordingRoles: vi.fn(async () => []),
      removeRecordingRole: vi.fn(async () => undefined),
      setGuildSettings: vi.fn(async () => undefined),
      setSummaryForum: vi.fn(async () => undefined),
    },
    guildDirectory: {
      getMemberDisplayNames: vi.fn(async () => new Map([["user-1", "Ana atual"]])),
      getInstalledGuildIds: vi.fn(async () => new Set(["guild-installed"])),
      getResources: vi.fn(async () => ({
        forums: [],
        memberCounts: { status: "available" as const },
        roles: [],
      })),
    },
    health: {
      getStatus: vi.fn(async () => ({
        checkedAt: "2026-09-07T12:00:00.000Z",
        components: [],
        database: { latencyMs: 1, migrationVersion: 12, status: "ready" as const },
        localAiRequired: false,
        queue: { active: 0, failed: 0, oldestPendingAt: null, scheduled: 0 },
      })),
    },
    liveMeetings: { getForGuild: vi.fn(async () => null) },
    logger: createLogger("silent"),
    secureCookies: false,
    settings: {
      completeSetup: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => ({
        discordClientId: null,
        publicBaseUrl: null,
        registrationEnabled: true,
        secrets: {
          discordBotToken: false,
          discordClientSecret: false,
          openRouterApiKey: false,
          smtpPassword: false,
        },
        setupCompleted: false,
        smtp: null,
      })),
      removeSecret: vi.fn(async () => undefined),
      setSecret: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
    },
    setupToken: "setup-token-value",
    timeZone: "America/Sao_Paulo",
    tasks: {
      list: vi.fn(async () => []),
      setCompleted: vi.fn(async () => undefined),
    },
  };
}

function setupPayload() {
  return {
    administrator: {
      dashboardLanguage: "pt-BR",
      email: "owner@example.com",
      password: "correct horse battery",
    },
    installation: {
      discordClientId: "client-id",
      publicBaseUrl: "http://127.0.0.1:8787",
      registrationEnabled: true,
      secrets: {
        discordBotToken: "discord-token",
        discordClientSecret: "discord-secret",
        smtpPassword: "smtp-secret",
      },
      smtp: {
        fromEmail: "hello@example.com",
        fromName: "Summyz Community",
        host: "smtp-relay.brevo.com",
        port: 587,
        replyTo: null,
        secure: false,
        user: "smtp-user",
      },
    },
  };
}
