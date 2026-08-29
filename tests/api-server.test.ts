import { describe, expect, it, vi } from "vitest";

import { createApiServer, type ApiServerDependencies } from "../src/api/server.js";
import { createInitialAiProfile } from "../src/ai-profile.js";
import { SessionTokenError } from "../src/auth/jwt-session.js";

const authenticatedUser = {
  dashboardLanguage: "pt-BR" as const,
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
});

function createDependencies(): ApiServerDependencies {
  const profile = createInitialAiProfile(authenticatedUser.userId, "external", "pt-BR");
  return {
    aiProfiles: {
      clearActiveProfile: vi.fn(async () => undefined),
      createProfile: vi.fn(async () => undefined),
      deleteProfile: vi.fn(async () => undefined),
      ensureInitialProfiles: vi.fn(async () => undefined),
      getActiveProfile: vi.fn(async () => profile),
      getActiveProfileForDiscordOwner: vi.fn(async () => profile),
      listActiveProfileIds: vi.fn(async () => new Set([profile.profileId])),
      listProfiles: vi.fn(async () => [profile]),
      setActiveProfile: vi.fn(async () => undefined),
      updateProfile: vi.fn(async () => undefined),
    },
    auth: {
      authenticate: vi.fn(async () => authenticatedUser),
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
      getInstalledGuildIds: vi.fn(async () => new Set(["guild-installed"])),
      getResources: vi.fn(async () => ({ forums: [], roles: [] })),
    },
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
        fromName: "Summyz",
        host: "smtp-relay.brevo.com",
        port: 587,
        replyTo: null,
        secure: false,
        user: "smtp-user",
      },
    },
  };
}
