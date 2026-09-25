import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createInitialAiProfile } from "../src/ai-profile.js";
import { type ApiServerDependencies, createApiServer } from "../src/api/server.js";
import { InstallationPasswordError } from "../src/auth/installation-password.js";
import { createLogger } from "../src/logger.js";

describe("Community dashboard API", () => {
  it("treats stored summary validation failures as internal errors in detail and export", async () => {
    const dependencies = createDependencies("local");
    const error = vi.fn();
    const sensitiveDetail = "private stored transcript";
    dependencies.logger = { ...dependencies.logger, error };
    dependencies.analytics = {
      getDashboard: vi.fn(async () => {
        throw new Error("unused");
      }),
      getGuildCallCount: vi.fn(async () => 0),
      getMeeting: vi.fn(async () => {
        z.object({
          languageValidation: z.string().refine(() => false, sensitiveDetail),
        }).parse({ languageValidation: "invalid" });
        throw new Error("unreachable");
      }),
      listMeetings: vi.fn(async () => {
        throw new Error("unused");
      }),
      updateDisplayNames: vi.fn(async () => undefined),
      updateParticipantProfiles: vi.fn(async () => undefined),
    };
    const app = await createApiServer(dependencies);

    for (const suffix of ["", "/export"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/guilds/guild-1/meetings/meeting-1${suffix}`,
      });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "internal_error" });
      expect(response.body).not.toContain("languageValidation");
      expect(response.body).not.toContain(sensitiveDetail);
    }
    expect(error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain("languageValidation");
    expect(JSON.stringify(error.mock.calls)).not.toContain(sensitiveDetail);
    await app.close();
  });

  it("keeps malformed request data as a 400 validation error", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const query = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/meetings?state=unknown",
    });
    expect(query.statusCode).toBe(400);
    expect(query.json()).toMatchObject({ error: "invalid_request", issues: expect.any(Array) });

    await app.close();

    const publicDependencies = createDependencies("public");
    const publicApp = await createApiServer(publicDependencies);
    const password = await publicApp.inject({
      cookies: { summyz_session: "session-token" },
      headers: { origin: "https://summyz.example.com" },
      method: "PUT",
      payload: { currentPassword: "senha anterior bastante segura", newPassword: "curta" },
      url: "/api/access/password",
    });
    expect(password.statusCode).toBe(400);
    expect(publicDependencies.passwords.change).not.toHaveBeenCalled();

    const recovery = await publicApp.inject({
      headers: {
        origin: "https://summyz.example.com",
        "x-summyz-recovery-token": "valid-token",
      },
      method: "POST",
      payload: { newPassword: "curta" },
      url: "/api/access/recovery",
    });
    expect(recovery.statusCode).toBe(400);
    expect(publicDependencies.recovery.recover).not.toHaveBeenCalled();

    const emptySession = await publicApp.inject({
      cookies: { summyz_session: "" },
      method: "GET",
      url: "/api/commands",
    });
    expect(emptySession.statusCode).toBe(401);
    await publicApp.close();
  });

  it("clears an empty logout cookie without calling the session store", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);

    const emptySession = await app.inject({
      cookies: { summyz_session: "" },
      headers: { origin: "https://summyz.example.com" },
      method: "POST",
      url: "/api/access/logout",
    });
    expect(emptySession.statusCode).toBe(204);
    expect(emptySession.headers["set-cookie"]).toContain("summyz_session=");
    expect(dependencies.auth.logout).not.toHaveBeenCalled();

    const activeSession = await app.inject({
      cookies: { summyz_session: "active-session" },
      headers: { origin: "https://summyz.example.com" },
      method: "POST",
      url: "/api/access/logout",
    });
    expect(activeSession.statusCode).toBe(204);
    expect(dependencies.auth.logout).toHaveBeenCalledExactlyOnceWith("active-session");
    await app.close();
  });

  it("accepts a transcription language and rejects the removed translation field", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    const { profileId: _profileId, ...body } = createInitialAiProfile("external", "pt-BR");
    const payload = {
      ...body,
      language: "en",
      transcription: { ...body.transcription, language: "pt-BR" },
    };

    const accepted = await app.inject({ method: "POST", payload, url: "/api/profiles" });
    const rejected = await app.inject({
      method: "POST",
      payload: { ...payload, translation: null },
      url: "/api/profiles",
    });

    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().transcription.language).toBe("pt-BR");
    expect(accepted.json()).not.toHaveProperty("translation");
    expect(rejected.statusCode).toBe(400);
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it("completes local setup using only a validated Discord bot token", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.aiProfiles.listProfiles).mockResolvedValue([]);
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "POST",
      payload: { discordBotToken: "bot-token" },
      url: "/api/setup",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.guildDirectory.inspectBotToken).toHaveBeenCalledWith("bot-token");
    expect(dependencies.settings.configureDiscordBot).toHaveBeenCalledWith(
      "application-1",
      "bot-token",
    );
    expect(dependencies.passwords.initialize).not.toHaveBeenCalled();
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledTimes(2);
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileType: "external" }),
    );
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({ profileType: "local" }),
    );
    expect(response.body).not.toContain("bot-token");
    await app.close();
  });

  it("requires the private setup claim and an installation password in public mode", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);
    const headers = {
      origin: "https://summyz.example.com",
      "x-summyz-setup-token": "setup-token-value-with-at-least-32-chars",
    };

    const invalidClaim = await app.inject({
      headers: {
        origin: "https://summyz.example.com",
        "x-summyz-setup-token": "invalid-setup-claim",
      },
      method: "POST",
      payload: {
        discordBotToken: "bot-token",
        installationPassword: "uma frase secreta bem segura",
      },
      url: "/api/setup",
    });

    const missingPassword = await app.inject({
      headers,
      method: "POST",
      payload: { discordBotToken: "bot-token" },
      url: "/api/setup",
    });
    const accepted = await app.inject({
      headers,
      method: "POST",
      payload: {
        discordBotToken: "bot-token",
        installationPassword: "uma frase secreta bem segura",
      },
      url: "/api/setup",
    });

    expect(invalidClaim.statusCode).toBe(403);
    expect(missingPassword.statusCode).toBe(400);
    expect(accepted.statusCode).toBe(204);
    expect(dependencies.passwords.initialize).toHaveBeenCalledWith("uma frase secreta bem segura");
    expect(accepted.headers["set-cookie"]).toContain("HttpOnly");
    expect(accepted.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(accepted.headers["set-cookie"]).toContain("Secure");
    await app.close();
  });

  it("authenticates public mode with the installation password and an opaque cookie", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);
    const response = await app.inject({
      headers: { origin: "https://summyz.example.com" },
      method: "POST",
      payload: { password: "uma frase secreta bem segura" },
      url: "/api/access/login",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.passwords.authenticate).toHaveBeenCalledWith(
      "uma frase secreta bem segura",
    );
    expect(response.headers["set-cookie"]).toContain("summyz_session=session-token");
    expect(response.body).not.toContain("frase secreta");
    await app.close();
  });

  it("changes the installation password and keeps the newly issued session", async () => {
    const dependencies = createDependencies("public");
    vi.mocked(dependencies.auth.create).mockResolvedValue("fresh-session");
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      cookies: { summyz_session: "old-session" },
      headers: { origin: "https://summyz.example.com" },
      method: "PUT",
      payload: {
        currentPassword: "senha anterior bastante segura",
        newPassword: "senha substituta bastante segura",
      },
      url: "/api/access/password",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.passwords.change).toHaveBeenCalledWith(
      "senha anterior bastante segura",
      "senha substituta bastante segura",
    );
    expect(JSON.stringify(response.headers["set-cookie"])).toContain(
      "summyz_session=fresh-session",
    );
    expect(JSON.stringify(response.headers["set-cookie"])).not.toContain(
      "summyz_session=old-session",
    );
    await app.close();
  });

  it("rejects cross-origin mutations in public mode", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      headers: { origin: "https://attacker.example.com" },
      method: "POST",
      payload: { password: "uma frase secreta bem segura" },
      url: "/api/access/login",
    });

    expect(response.statusCode).toBe(403);
    expect(dependencies.passwords.authenticate).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects public dashboard access without a session and permits local access", async () => {
    const publicApp = await createApiServer(createDependencies("public"));
    const localApp = await createApiServer(createDependencies("local"));

    expect((await publicApp.inject({ method: "GET", url: "/api/guilds" })).statusCode).toBe(401);
    expect((await localApp.inject({ method: "GET", url: "/api/guilds" })).json()).toEqual([
      expect.objectContaining({ id: "guild-1", name: "Equipe" }),
    ]);
    await publicApp.close();
    await localApp.close();
  });

  it("returns the command reference in the persisted dashboard language", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      dashboardLanguage: "en",
      dashboardTheme: "system",
      discordApplicationId: null,
      secrets: { discordBotToken: false, openRouterApiKey: false },
      setupCompleted: false,
    });
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/commands" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        commands: [
          {
            description: "Starts recording the voice channel you are in",
            name: "/record",
          },
          {
            description: "Stops recording the voice channel you are in",
            name: "/stop",
          },
        ],
        label: "Recording",
      },
      expect.objectContaining({ label: "Administrative shortcuts" }),
      expect.objectContaining({ label: "Cost — server owner only" }),
    ]);
    await app.close();
  });

  it("returns only the database readiness status in installation health", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "GET",
      url: "/api/installation/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().database).toEqual({ status: "ready" });
    await app.close();
  });

  it("requires public dashboard access for the command reference", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);

    const rejected = await app.inject({ method: "GET", url: "/api/commands" });
    const accepted = await app.inject({
      cookies: { summyz_session: "session-token" },
      method: "GET",
      url: "/api/commands",
    });

    expect(rejected.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()[0]).toMatchObject({ label: "Gravação" });
    await app.close();
  });

  it("authorizes only guilds where the configured bot is installed", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const accepted = await app.inject({
      method: "PUT",
      payload: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-1/settings",
    });
    const rejected = await app.inject({
      method: "PUT",
      payload: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-2/settings",
    });

    expect(accepted.statusCode).toBe(204);
    expect(rejected.statusCode).toBe(403);
    await app.close();
  });

  it("exposes a generic Discord installation URL without user OAuth", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
      discordApplicationId: "application-1",
      secrets: { discordBotToken: true, openRouterApiKey: false },
      setupCompleted: true,
    });
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/installation/bot" });

    expect(response.json()).toMatchObject({ applicationId: "application-1", configured: true });
    expect(response.json().installUrl).toContain("client_id=application-1");
    expect(response.json().installUrl).toContain("applications.commands");
    await app.close();
  });

  it("validates bot token rotation before storing the new application id", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "PUT",
      payload: { discordBotToken: "rotated-token" },
      url: "/api/installation/bot",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.guildDirectory.inspectBotToken).toHaveBeenCalledWith("rotated-token");
    expect(dependencies.settings.configureDiscordBot).toHaveBeenCalledWith(
      "application-1",
      "rotated-token",
    );
    await app.close();
  });

  it("recovers public access with a single-use host token and issues a fresh session", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);
    const response = await app.inject({
      headers: {
        origin: "https://summyz.example.com",
        "x-summyz-recovery-token": "one-time-host-recovery-token",
      },
      method: "POST",
      payload: { newPassword: "uma nova frase secreta segura" },
      url: "/api/access/recovery",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.recovery.recover).toHaveBeenCalledWith(
      "one-time-host-recovery-token",
      "uma nova frase secreta segura",
    );
    expect(JSON.stringify(response.headers["set-cookie"])).toContain(
      "summyz_session=session-token",
    );
    await app.close();
  });

  it("marks dashboard task completion without attributing a Discord user", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    const taskId = "00000000-0000-4000-8000-000000000001";

    const response = await app.inject({
      method: "PATCH",
      payload: { completed: true },
      url: `/api/guilds/guild-1/tasks/${taskId}/completion`,
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.tasks.setCompleted).toHaveBeenCalledWith("guild-1", taskId, null, true);
    await app.close();
  });

  it("removes all account and Discord user OAuth routes", async () => {
    const app = await createApiServer(createDependencies("local"));
    const removed = await Promise.all(
      [
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/forgot-password",
        "/api/auth/change-password",
        "/api/auth/discord",
        "/api/setup/discord",
        "/api/discord/connect",
        "/api/discord/callback",
        "/api/discord/connection",
      ].map((url) => app.inject({ method: "GET", url })),
    );

    expect(removed.every((response) => response.statusCode === 404)).toBe(true);
    await app.close();
  });

  it("never logs a rejected installation password", async () => {
    const dependencies = createDependencies("public");
    const error = vi.fn();
    dependencies.logger = { ...dependencies.logger, error };
    vi.mocked(dependencies.passwords.authenticate).mockRejectedValue(
      new InstallationPasswordError("invalid_password"),
    );
    const app = await createApiServer(dependencies);
    const password = "senha sigilosa que nunca aparece";

    const response = await app.inject({
      headers: { origin: "https://summyz.example.com" },
      method: "POST",
      payload: { password },
      url: "/api/access/login",
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.stringify(error.mock.calls)).not.toContain(password);
    await app.close();
  });
});

function createDependencies(accessMode: "local" | "public"): ApiServerDependencies {
  const profile = createInitialAiProfile("external", "pt-BR");
  return {
    accessMode,
    aiProfiles: {
      clearActiveProfile: vi.fn(async () => undefined),
      createProfile: vi.fn(async () => undefined),
      deleteProfile: vi.fn(async () => undefined),
      getActiveProfile: vi.fn(async () => profile),
      listActiveProfileCounts: vi.fn(async () => new Map([[profile.profileId, 1]])),
      listActiveProfileIds: vi.fn(async () => new Set([profile.profileId])),
      listProfiles: vi.fn(async () => [profile]),
      setActiveProfile: vi.fn(async () => undefined),
      updateProfile: vi.fn(async () => undefined),
    },
    auth: {
      authenticate: vi.fn(async () => ({
        dashboardLanguage: "pt-BR" as const,
        dashboardTheme: "system" as const,
      })),
      create: vi.fn(async () => "session-token"),
      logout: vi.fn(async () => undefined),
    },
    guildConfig: {
      clearSummaryForum: vi.fn(async () => undefined),
      getGuildSettings: vi.fn(async () => ({
        botLanguage: "en" as const,
        persistMeetingAudio: false,
        persistMeetingContent: true,
      })),
      getRecordingPermissions: vi.fn(async () => ({ roleIds: [], userGrants: [] })),
      getSummaryForum: vi.fn(async () => undefined),
      removeRecordingUser: vi.fn(async () => undefined),
      setGuildSettings: vi.fn(async () => undefined),
      setRecordingPermissions: vi.fn(async () => undefined),
      setSummaryForum: vi.fn(async () => undefined),
    },
    guildDirectory: {
      getMembersByIds: vi.fn(async () => new Map()),
      getResources: vi.fn(async () => ({
        forums: [],
        memberCounts: { status: "available" as const },
        roles: [],
      })),
      inspectBotToken: vi.fn(async () => ({
        iconUrl: null,
        id: "application-1",
        name: "Summyz",
      })),
      listInstalledGuilds: vi.fn(async () => [{ iconUrl: null, id: "guild-1", name: "Equipe" }]),
      listMembers: vi.fn(async () => ({
        items: [],
        page: 1,
        pageSize: 50,
        status: "available" as const,
        total: 0,
      })),
    },
    health: {
      getStatus: vi.fn(async () => ({
        checkedAt: "2026-09-09T12:00:00.000Z",
        components: [],
        database: { status: "ready" as const },
        localAiRequired: false,
        queue: { active: 0, failed: 0, oldestPendingAt: null, scheduled: 0 },
      })),
    },
    liveMeetings: { getForGuild: vi.fn(async () => null) },
    logger: createLogger("silent"),
    participants: { list: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })) },
    passwords: {
      authenticate: vi.fn(async () => undefined),
      change: vi.fn(async () => undefined),
      initialize: vi.fn(async () => undefined),
      isConfigured: vi.fn(async () => accessMode === "public"),
    },
    publicBaseUrl: "https://summyz.example.com",
    recovery: { recover: vi.fn(async () => undefined) },
    settings: {
      completeSetup: vi.fn(async () => undefined),
      configureDiscordBot: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => ({
        dashboardLanguage: "pt-BR" as const,
        dashboardTheme: "system" as const,
        discordApplicationId: null,
        secrets: { discordBotToken: false, openRouterApiKey: false },
        setupCompleted: false,
      })),
      removeSecret: vi.fn(async () => undefined),
      setSecret: vi.fn(async () => undefined),
      updatePreferences: vi.fn(async () => undefined),
    },
    setupToken: "setup-token-value-with-at-least-32-chars",
    tasks: {
      list: vi.fn(async () => []),
      setCompleted: vi.fn(async () => undefined),
    },
  };
}
