import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { aiProfileSchema, createInitialAiProfile } from "../src/ai-profile.js";
import { type ApiServerDependencies, createApiServer } from "../src/api/server.js";
import { InstallationPasswordError } from "../src/auth/installation-password.js";
import { DiscordBotRotationError } from "../src/database/postgres-installation-settings-store.js";
import { createDiscordApiFetch, DiscordRateLimitError } from "../src/discord/discord-api-fetch.js";
import { DiscordConnectionError } from "../src/discord/installation-discord-connection.js";
import { createLogger } from "../src/logger.js";

// Browsers always send Origin on mutations; local mode accepts only loopback origins.
const localOrigin = { origin: "http://127.0.0.1:8787" };

describe("Community dashboard API", () => {
  it.each(["local", "public"] as const)(
    "exposes the account avatar only with %s dashboard authorization",
    async (mode) => {
      const dependencies = createDependencies(mode);
      const profile = {
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png",
        connected: true as const,
        discordUserId: "owner-a",
        discordUsername: "Current Name",
      };
      dependencies.discordConnection.getConnectionProfile = vi.fn(async () => profile);
      const app = await createApiServer(dependencies);
      try {
        if (mode === "public") {
          expect((await app.inject("/api/discord/connection")).statusCode).toBe(401);
          expect(dependencies.discordConnection.getConnectionProfile).not.toHaveBeenCalled();
        }
        const response = await app.inject({
          url: "/api/discord/connection",
          cookies: { summyz_session: "session-token" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(profile);
        expect(dependencies.discordConnection.getConnectionStatus).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it.each(["local", "public"] as const)(
    "reads hardware only with %s dashboard authorization and exposes no inventory refresh",
    async (mode) => {
      const dependencies = createDependencies(mode);
      const hardware = { cpuCores: 4, memoryBytes: 8 * 1024 ** 3, accelerators: [] };
      const readHardware = vi.fn(async () => hardware);
      dependencies.hardware = { readHardware };
      const app = await createApiServer(dependencies);
      try {
        const origin = mode === "public" ? "https://summyz.example.com" : localOrigin.origin;
        if (mode === "public") {
          expect((await app.inject("/api/local-ai/hardware")).statusCode).toBe(401);
          expect(readHardware).not.toHaveBeenCalled();
        }
        const response = await app.inject({
          url: "/api/local-ai/hardware",
          headers: { origin },
          cookies: { summyz_session: "session-token" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ hardware });
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/local-ai/hardware/refresh",
              headers: { origin },
              cookies: { summyz_session: "session-token" },
            })
          ).statusCode,
        ).toBe(404);
      } finally {
        await app.close();
      }
    },
  );
  it("limits total Discord rate-limit waiting across one dashboard request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "retry-after": "0.02" } }),
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "5" } }));
    const requestDiscord = createDiscordApiFetch(fetchMock);
    const app = await createApiServer(createDependencies("local"));
    app.get("/api/test-discord-wait-budget", async () => {
      await requestDiscord("https://discord.com/api/v10/users/@me/guilds");
      await requestDiscord("https://discord.com/api/v10/guilds/guild-1/channels");
      return { ok: true };
    });

    const response = await app.inject({ method: "GET", url: "/api/test-discord-wait-budget" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("5");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it("returns a temporary error with Retry-After when Discord delays guild access", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.guildDirectory.listInstalledGuilds).mockRejectedValue(
      new DiscordRateLimitError(12),
    );
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/configuration",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("12");
    expect(response.json()).toEqual({ error: "discord_rate_limited" });
    await app.close();
  });

  it("does not disguise Discord rate limiting as a successful server list", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.discordConnection.listOwnedGuilds).mockRejectedValue(
      new DiscordRateLimitError(12),
    );
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/guilds" });

    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("12");
    await app.close();
  });

  it("preserves a safe Discord connection status through the dependency boundary", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.discordConnection.listOwnedGuilds).mockRejectedValue(
      new DiscordConnectionError("discord_oauth_unavailable", 502),
    );
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/configuration",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "discord_oauth_unavailable" });
    await app.close();
  });

  it("keeps saved history readable without Discord OAuth while writes remain restricted", async () => {
    const dependencies = createDependencies("local");
    dependencies.analytics = analyticsDependencies();
    dependencies.guildHistory.list = vi.fn(async () => [
      { iconUrl: null, id: "guild-1", name: "Equipe antiga" },
    ]);
    dependencies.discordConnection.getConnectionStatus = vi.fn(async () => ({
      connected: false as const,
    }));
    dependencies.discordConnection.listOwnedGuilds = vi.fn(async () => {
      throw new Error("OAuth unavailable");
    });
    const app = await createApiServer(dependencies);

    const guilds = await app.inject({ method: "GET", url: "/api/guilds" });
    const history = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/meetings?timeZone=UTC",
    });
    const configuration = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/configuration",
    });

    expect(guilds.statusCode).toBe(200);
    expect(guilds.json()).toEqual([
      expect.objectContaining({ id: "guild-1", name: "Equipe antiga" }),
    ]);
    expect(history.statusCode).toBe(200);
    expect(configuration.statusCode).toBe(403);
    await app.close();
  });
  it("passes each browser zone to history and rolling analytics without persisting it", async () => {
    const dependencies = createDependencies("local");
    const analytics = analyticsDependencies();
    dependencies.analytics = analytics;
    const app = await createApiServer(dependencies);
    for (const timeZone of ["America/Sao_Paulo", "Europe/Lisbon", "UTC"]) {
      const query = new URLSearchParams({ timeZone, dateFrom: "2026-09-28", dateTo: "2026-09-28" });
      const history = await app.inject({
        method: "GET",
        url: `/api/guilds/guild-1/meetings?${query}`,
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().timeZone).toBe(timeZone);
      expect(analytics.listMeetings).toHaveBeenLastCalledWith(
        "guild-1",
        expect.objectContaining({ timeZone, dateFrom: "2026-09-28", dateTo: "2026-09-28" }),
      );
      const dashboard = await app.inject({
        method: "GET",
        url: `/api/guilds/guild-1/dashboard?${new URLSearchParams({ timeZone, period: "90d" })}`,
      });
      expect(dashboard.statusCode).toBe(200);
      expect(dashboard.json().timeZone).toBe(timeZone);
      expect(analytics.getDashboard).toHaveBeenLastCalledWith("guild-1", {
        period: "90d",
        timeZone,
      });
    }
    expect(dependencies.settings.getSettings).not.toHaveBeenCalled();
    await app.close();
  });
  it("reads the cost detail for an inclusive calendar range in the browser zone", async () => {
    const dependencies = createDependencies("local");
    const analytics = analyticsDependencies();
    dependencies.analytics = analytics;
    const app = await createApiServer(dependencies);
    const query = new URLSearchParams({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      timeZone: "Europe/Lisbon",
    });

    const response = await app.inject({ method: "GET", url: `/api/guilds/guild-1/costs?${query}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      meetingCount: 0,
      timeZone: "Europe/Lisbon",
    });
    expect(analytics.getCostDetail).toHaveBeenCalledWith("guild-1", {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      timeZone: "Europe/Lisbon",
    });
    await app.close();
  });
  it.each([
    "timeZone=UTC&dateTo=2026-09-30",
    "timeZone=UTC&dateFrom=2026-09-30&dateTo=2026-09-01",
    "timeZone=Mars%2FOlympus&dateFrom=2026-09-01&dateTo=2026-09-30",
  ])("rejects the cost query %s before analytics access", async (search) => {
    const dependencies = createDependencies("local");
    const analytics = analyticsDependencies();
    dependencies.analytics = analytics;
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      method: "GET",
      url: `/api/guilds/guild-1/costs?${search}`,
    });

    expect(response.statusCode).toBe(400);
    expect(analytics.getCostDetail).not.toHaveBeenCalled();
    await app.close();
  });
  it("exports the requested date and clock while preserving summary language and spoken deadlines", async () => {
    const dependencies = createDependencies("local");
    dependencies.analytics = analyticsDependencies();
    const app = await createApiServer(dependencies);
    const query = new URLSearchParams({
      timeZone: "America/Sao_Paulo",
      dateFormat: "MM/DD/YYYY",
      timeFormat: "12h",
    });
    const response = await app.inject({
      method: "GET",
      url: `/api/guilds/guild-1/meetings/meeting-1/export?${query}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("Started at: 09/28/2026 11:30 PM");
    expect(response.body).toContain("Time zone: America/Sao_Paulo");
    expect(response.body).toContain("Executive summary\nThe release was approved.");
    expect(response.body).toContain("Deadline: amanhã");
    expect(response.body).toContain("Ana: Vamos publicar amanhã.");
    await app.close();
  });
  it("rejects profile writes without prompt ownership and preserves custom input", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    const { profileId: _id, ...base } = createInitialAiProfile("external", "en");
    const body = {
      ...base,
      promptModes: { ...base.promptModes, refinement: "custom" as const },
      transcription: { ...base.transcription, model: "vendor/stt" },
      refinement: { ...base.refinement, model: "vendor/text", prompt: "  Revise em português.  " },
      summary: { ...base.summary, model: "vendor/text" },
    };
    const { promptModes: _modes, ...invalid } = body;
    expect(
      (
        await app.inject({
          headers: localOrigin,
          method: "POST",
          url: "/api/profiles",
          payload: invalid,
        })
      ).statusCode,
    ).toBe(400);
    const created = await app.inject({
      headers: localOrigin,
      method: "POST",
      url: "/api/profiles",
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().refinement.prompt).toBe(body.refinement.prompt);
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        promptModes: body.promptModes,
        refinement: expect.objectContaining({ prompt: body.refinement.prompt }),
      }),
    );
    await app.close();
  });

  it("keeps settings and local authorization independent of presentation preferences", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    vi.mocked(dependencies.settings.getSettings).mockClear();
    expect((await app.inject({ method: "GET", url: "/api/commands" })).statusCode).toBe(200);
    expect(dependencies.settings.getSettings).not.toHaveBeenCalled();
    for (const url of ["/api/settings", "/api/installation/settings"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.json()).not.toHaveProperty("dashboardLanguage");
      expect(response.json()).not.toHaveProperty("dashboardTheme");
    }
    expect(
      (
        await app.inject({
          headers: localOrigin,
          method: "PUT",
          url: "/api/settings/preferences",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });
  it("exposes the Discord OAuth redirect and client secret status to the dashboard", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      discordApplicationId: "application-1",
      secrets: { discordBotToken: true, discordClientSecret: true, openRouterApiKey: false },
      setupCompleted: true,
    });
    const app = await createApiServer(dependencies);

    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    const setupStatus = await app.inject({ method: "GET", url: "/api/setup/status" });

    expect(settings.json()).toMatchObject({
      discordRedirectUri: "https://summyz.example.com/api/discord/callback",
      secrets: { discordClientSecret: true },
    });
    expect(setupStatus.json()).toMatchObject({
      discordRedirectUri: "https://summyz.example.com/api/discord/callback",
    });
    await app.close();
  });
  it("requires setup language before inspecting or storing credentials", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    for (const setupLanguage of [undefined, "fr"]) {
      expect(
        (
          await app.inject({
            headers: localOrigin,
            method: "POST",
            url: "/api/setup",
            payload: { discordBotToken: "bot-token", setupLanguage },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(dependencies.guildDirectory.inspectBotToken).not.toHaveBeenCalled();
    expect(dependencies.settings.configureDiscordBot).not.toHaveBeenCalled();
    await app.close();
  });
  it("returns fixed English prompt defaults without using dashboard locale", async () => {
    const app = await createApiServer(createDependencies("local"));
    const response = await app.inject({
      method: "GET",
      url: "/api/ai/prompts/defaults?summaryLanguage=pt-BR",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().summaryExtraction).toContain("in Brazilian Portuguese");
    expect(response.json().refinement).toContain("conservative transcript reviewer");
    expect(
      (await app.inject({ method: "GET", url: "/api/ai/prompts/defaults?summaryLanguage=invalid" }))
        .statusCode,
    ).toBe(400);
    await app.close();
  });
  it("rejects missing and invalid calendar zones before analytics access", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    for (const route of ["dashboard", "meetings", "meetings/meeting-1"]) {
      for (const suffix of ["", "?timeZone=Mars%2FOlympus"]) {
        expect(
          (await app.inject({ method: "GET", url: `/api/guilds/guild-1/${route}${suffix}` }))
            .statusCode,
        ).toBe(400);
      }
    }
    for (const suffix of [
      "",
      "?timeZone=UTC",
      "?timeZone=UTC&dateFormat=DD%2FMM%2FYYYY&timeFormat=bad",
    ]) {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/api/guilds/guild-1/meetings/meeting-1/export${suffix}`,
          })
        ).statusCode,
      ).toBe(400);
    }
    await app.close();
  });

  it("exposes model catalog, downloads, cancellation and deletion behind dashboard access", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    const catalog = await app.inject({
      method: "GET",
      url: "/api/models?phase=summary&provider=ollama&family=qwen3",
    });
    expect(catalog.statusCode).toBe(200);
    expect(dependencies.models?.catalog.list).toHaveBeenCalledWith({
      phase: "summary",
      provider: "ollama",
      family: "qwen3",
    });
    const download = await app.inject({
      headers: localOrigin,
      method: "POST",
      url: "/api/models/downloads",
      payload: { phase: "summary", provider: "ollama", model: "qwen3:8b" },
    });
    expect(download.statusCode).toBe(202);
    expect(download.json()).not.toHaveProperty("partialDigests");
    const cancel = await app.inject({
      headers: localOrigin,
      method: "POST",
      url: "/api/models/downloads/63d3b8c0-e02a-4fdf-8179-a0feec79e7c1/cancel",
    });
    expect(cancel.statusCode).toBe(202);
    expect(
      (
        await app.inject({
          headers: localOrigin,
          method: "DELETE",
          url: "/api/models",
          payload: { provider: "ollama", model: "qwen3:8b" },
        })
      ).statusCode,
    ).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/models/downloads" })).json()).toHaveLength(
      1,
    );
    expect(
      (await app.inject({ method: "GET", url: "/api/models?phase=invalid&provider=ollama" }))
        .statusCode,
    ).toBe(400);
    const profiles = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(profiles.json()[0].availability.status).toBe("ready");
    const settings = await app.inject({ method: "GET", url: "/api/guilds/guild-1/configuration" });
    expect(settings.json().profiles[0].availability.status).toBe("ready");
    await app.close();
    const publicApp = await createApiServer(createDependencies("public"));
    expect(
      (await publicApp.inject({ method: "GET", url: "/api/models?phase=summary&provider=ollama" }))
        .statusCode,
    ).toBe(401);
    expect(
      (await publicApp.inject({ method: "POST", url: "/api/models/downloads", payload: {} }))
        .statusCode,
    ).toBe(403);
    await publicApp.close();
  });
  it("treats stored summary validation failures as internal errors in detail and export", async () => {
    const dependencies = createDependencies("local");
    const error = vi.fn();
    const sensitiveDetail = "private stored transcript";
    dependencies.logger = { ...dependencies.logger, error };
    dependencies.analytics = {
      getCostDetail: vi.fn(async () => {
        throw new Error("unused");
      }),
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
        url: `/api/guilds/guild-1/meetings/meeting-1${suffix}?timeZone=UTC&dateFormat=YYYY-MM-DD&timeFormat=24h`,
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
      transcription: { ...body.transcription, language: "pt-BR", model: "vendor/stt" },
      refinement: { ...body.refinement, model: "vendor/text" },
      summary: { ...body.summary, model: "vendor/text" },
    };

    const accepted = await app.inject({
      headers: localOrigin,
      method: "POST",
      payload,
      url: "/api/profiles",
    });
    const rejected = await app.inject({
      headers: localOrigin,
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
      headers: localOrigin,
      method: "POST",
      payload: { discordBotToken: "bot-token", setupLanguage: "pt-BR" },
      url: "/api/setup",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.guildDirectory.inspectBotToken).toHaveBeenCalledWith("bot-token");
    expect(dependencies.settings.configureDiscordBot).toHaveBeenCalledWith(
      "application-1",
      "bot-token",
    );
    expect(dependencies.passwords.initialize).not.toHaveBeenCalled();
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledTimes(1);
    expect(dependencies.aiProfiles.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Perfil 1",
        promptModes: expect.objectContaining({ refinement: "default" }),
        refinement: expect.objectContaining({
          prompt: expect.stringContaining("conservative transcript reviewer"),
        }),
        profileType: null,
        transcription: expect.objectContaining({ provider: null, model: null }),
      }),
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
        setupLanguage: "pt-BR",
        installationPassword: "uma frase secreta bem segura",
      },
      url: "/api/setup",
    });

    const missingPassword = await app.inject({
      headers,
      method: "POST",
      payload: { discordBotToken: "bot-token", setupLanguage: "pt-BR" },
      url: "/api/setup",
    });
    const accepted = await app.inject({
      headers,
      method: "POST",
      payload: {
        discordBotToken: "bot-token",
        setupLanguage: "pt-BR",
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

  it("rejects local requests addressed to a non-loopback host", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    for (const host of [
      "attacker.example.com:8787",
      "127.0.0.1.attacker.example.com",
      "localhost.attacker.example.com:8787",
    ]) {
      const read = await app.inject({
        headers: { host },
        method: "GET",
        url: "/api/installation/settings",
      });
      const write = await app.inject({
        headers: { host, origin: `http://${host}` },
        method: "PUT",
        payload: { value: "attacker-key" },
        url: "/api/installation/secrets/openrouter_api_key",
      });
      expect(read.statusCode).toBe(403);
      expect(read.json()).toEqual({ error: "invalid_host" });
      expect(write.statusCode).toBe(403);
    }
    expect(dependencies.settings.getSettings).not.toHaveBeenCalled();
    expect(dependencies.settings.setSecret).not.toHaveBeenCalled();

    for (const host of ["127.0.0.1:8787", "localhost:5173", "[::1]:9000"]) {
      const response = await app.inject({
        headers: { host },
        method: "GET",
        url: "/api/installation/settings",
      });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });

  it("rejects local mutations without a loopback origin", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);
    const storeKey = (headers: Record<string, string>) =>
      app.inject({
        headers,
        method: "PUT",
        payload: { value: "openrouter-key" },
        url: "/api/installation/secrets/openrouter_api_key",
      });

    for (const origin of [
      undefined,
      "null",
      "https://attacker.example.com",
      "http://127.0.0.1.attacker.example.com:8787",
    ]) {
      const response = await storeKey(origin === undefined ? {} : { origin });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: "invalid_origin" });
    }
    expect(dependencies.settings.setSecret).not.toHaveBeenCalled();

    for (const origin of ["http://127.0.0.1:8787", "http://localhost:5173", "http://[::1]:9000"]) {
      expect((await storeKey({ origin })).statusCode).toBe(204);
    }
    expect(dependencies.settings.setSecret).toHaveBeenCalledTimes(3);
    await app.close();
  });

  it("serves public mode through its own domain", async () => {
    const app = await createApiServer(createDependencies("public"));

    const response = await app.inject({
      headers: { host: "summyz.example.com" },
      method: "GET",
      url: "/api/access/status",
    });

    expect(response.statusCode).toBe(200);
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

  it("returns the fixed English command reference with stable group identifiers", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      discordApplicationId: null,
      secrets: { discordBotToken: false, discordClientSecret: false, openRouterApiKey: false },
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
        id: "recording",
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
    expect(accepted.json()[0]).toMatchObject({ id: "recording", label: "Recording" });
    await app.close();
  });

  it("authorizes only guilds where the configured bot is installed", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const accepted = await app.inject({
      headers: localOrigin,
      method: "PUT",
      payload: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-1/settings",
    });
    const rejected = await app.inject({
      headers: localOrigin,
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

  it("does not expose a bot guild owned by another Discord account", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.guildDirectory.listInstalledGuilds).mockResolvedValue([
      { iconUrl: null, id: "guild-1", name: "Equipe" },
      { iconUrl: null, id: "guild-2", name: "Privado" },
    ]);
    const app = await createApiServer(dependencies);

    expect((await app.inject({ method: "GET", url: "/api/guilds" })).json()).toEqual([
      expect.objectContaining({ id: "guild-1" }),
    ]);
    const denied = await app.inject({
      headers: localOrigin,
      method: "PUT",
      payload: {
        botLanguage: "pt-BR",
        persistMeetingAudio: false,
        persistMeetingContent: true,
      },
      url: "/api/guilds/guild-2/settings",
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: "guild_access_denied",
      message: expect.stringMatching(/dono.*servidor|servidor.*dono/i),
    });
    expect(dependencies.guildConfig.setGuildSettings).not.toHaveBeenCalled();
    await app.close();
  });

  it("counts profile activations only in servers owned by the linked account", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.aiProfiles.listActiveProfileCounts).mockResolvedValue(
      new Map([["external-profile-1", 5]]),
    );
    const app = await createApiServer(dependencies);

    const profiles = (await app.inject({ method: "GET", url: "/api/profiles" })).json();
    expect(profiles[0].activeServerCount).toBe(1);
    await app.close();
  });

  it("lists owned servers without the bot but refuses configuration until installation", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.discordConnection.listOwnedGuilds).mockResolvedValue([
      { iconUrl: null, id: "guild-1", name: "Equipe" },
      { iconUrl: null, id: "guild-new", name: "Novo" },
    ]);
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      discordApplicationId: "application-1",
      secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: false },
      setupCompleted: true,
    });
    const app = await createApiServer(dependencies);

    const guilds = (await app.inject({ method: "GET", url: "/api/guilds" })).json();
    expect(guilds).toContainEqual(
      expect.objectContaining({ id: "guild-1", installed: true, owned: true }),
    );
    expect(guilds).toContainEqual(
      expect.objectContaining({
        id: "guild-new",
        installed: false,
        owned: true,
        installUrl: expect.stringContaining("guild_id=guild-new"),
      }),
    );
    const newGuild = guilds.find((guild: { id: string }) => guild.id === "guild-new");
    expect(new URL(newGuild.installUrl).searchParams.get("permissions")).toBe("274879057024");
    expect(
      (await app.inject({ method: "GET", url: "/api/guilds/guild-new/configuration" })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it("retains historical guild data when no Discord account is connected", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.discordConnection.getConnectionStatus).mockResolvedValue({
      connected: false,
    });
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/guilds" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toContainEqual(
      expect.objectContaining({ id: "guild-1", installed: false, owned: false }),
    );
    expect(dependencies.guildDirectory.listInstalledGuilds).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns only saved history if the linked account changes during the request", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.discordConnection.getConnectionStatus)
      .mockResolvedValueOnce({ connected: true, discordUserId: "owner-a", discordUsername: "A" })
      .mockResolvedValueOnce({ connected: true, discordUserId: "owner-b", discordUsername: "B" });
    vi.mocked(dependencies.discordConnection.listOwnedGuilds).mockResolvedValue([
      { iconUrl: null, id: "guild-new", name: "Novo" },
    ]);
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/guilds" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("guild-1");
    expect(response.body).not.toContain("guild-new");
    await app.close();
  });

  it("requires the new owner to confirm a transferred server before activation", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.guildOwnerApprovals.isConfirmed).mockResolvedValue(false);
    vi.mocked(dependencies.guildConfig.getSummaryForum).mockResolvedValue({ forumId: "forum-1" });
    const initialProfile = createInitialAiProfile("external", "pt-BR");
    vi.mocked(dependencies.aiProfiles.getActiveProfile).mockResolvedValue(
      aiProfileSchema.parse({
        ...initialProfile,
        transcription: { ...initialProfile.transcription, model: "vendor/audio" },
        refinement: { ...initialProfile.refinement, model: "vendor/text" },
        summary: { ...initialProfile.summary, model: "vendor/text" },
      }),
    );
    const app = await createApiServer(dependencies);

    const configuration = await app.inject({
      method: "GET",
      url: "/api/guilds/guild-1/configuration",
    });
    expect(configuration.json().ownerConfirmationRequired).toBe(true);
    const confirmed = await app.inject({
      headers: localOrigin,
      method: "POST",
      url: "/api/guilds/guild-1/activation",
    });
    expect(confirmed.statusCode).toBe(204);
    expect(dependencies.guildOwnerApprovals.confirm).toHaveBeenCalledWith("guild-1", "owner-a");
    await app.close();
  });

  it("requires the installation session to start and complete Discord linking", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);

    expect((await app.inject({ method: "GET", url: "/api/discord/connect" })).statusCode).toBe(401);
    const start = await app.inject({
      cookies: { summyz_session: "session-token" },
      method: "GET",
      url: "/api/discord/connect",
    });
    expect(start.json()).toEqual({ authorizationUrl: "https://discord.com/oauth2/authorize" });
    const oauthBinding = vi.mocked(dependencies.discordConnection.createAuthorizationUrl).mock
      .calls[0]?.[0];
    expect(oauthBinding).toBeTruthy();
    expect(JSON.stringify(start.headers["set-cookie"])).toContain("summyz_oauth=");
    expect(JSON.stringify(start.headers["set-cookie"])).toContain("SameSite=Lax");
    const withoutBinding = await app.inject({
      method: "GET",
      url: "/api/discord/callback?code=code&state=state",
    });
    expect(withoutBinding.statusCode).toBe(302);
    expect(withoutBinding.headers.location).toBe("/servers?discord=invalid_state");
    const callback = await app.inject({
      cookies: { summyz_oauth: oauthBinding ?? "" },
      method: "GET",
      url: "/api/discord/callback?code=code&state=state",
    });
    expect(callback.statusCode).toBe(302);
    expect(dependencies.discordConnection.completeAuthorization).toHaveBeenCalledWith(
      oauthBinding,
      "code",
      "state",
    );
    expect(JSON.stringify(callback.headers["set-cookie"])).toContain("summyz_session=");
    await app.close();
  });

  it("redirects a cancelled Discord authorization without replacing the connection", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);
    const response = await app.inject({
      cookies: { summyz_oauth: "browser-binding" },
      method: "GET",
      url: "/api/discord/callback?error=access_denied&state=state",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/servers?discord=cancelled");
    expect(dependencies.discordConnection.cancelAuthorization).toHaveBeenCalledWith(
      "browser-binding",
      "state",
    );
    expect(dependencies.discordConnection.completeAuthorization).not.toHaveBeenCalled();
    expect(JSON.stringify(response.headers["set-cookie"])).not.toContain("summyz_session=");
    await app.close();
  });

  it("redirects invalid OAuth state and provider failures with distinct safe indicators", async () => {
    const dependencies = createDependencies("public");
    const app = await createApiServer(dependencies);
    const invalidState = await app.inject({
      method: "GET",
      url: "/api/discord/callback?error=access_denied&state=state",
    });
    expect(invalidState.headers.location).toBe("/servers?discord=invalid_state");

    vi.mocked(dependencies.discordConnection.completeAuthorization).mockRejectedValueOnce(
      new DiscordConnectionError("discord_oauth_unavailable", 502),
    );
    const failed = await app.inject({
      cookies: { summyz_oauth: "browser-binding" },
      method: "GET",
      url: "/api/discord/callback?code=code&state=state",
    });
    expect(failed.statusCode).toBe(302);
    expect(failed.headers.location).toBe("/servers?discord=failed");
    expect(failed.body).not.toContain("discord_oauth_unavailable");
    await app.close();
  });

  it("exposes a generic Discord installation URL without user OAuth", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.getSettings).mockResolvedValue({
      discordApplicationId: "application-1",
      secrets: { discordBotToken: true, discordClientSecret: false, openRouterApiKey: false },
      setupCompleted: true,
    });
    const app = await createApiServer(dependencies);

    const response = await app.inject({ method: "GET", url: "/api/installation/bot" });

    expect(response.json()).toMatchObject({ applicationId: "application-1", configured: true });
    expect(response.json().installUrl).toContain("client_id=application-1");
    expect(response.json().installUrl).toContain("applications.commands");
    expect(new URL(response.json().installUrl).searchParams.get("permissions")).toBe(
      "274879057024",
    );
    await app.close();
  });

  it("validates bot token rotation before storing the new application id", async () => {
    const dependencies = createDependencies("local");
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      headers: localOrigin,
      method: "PUT",
      payload: { discordBotToken: "rotated-token" },
      url: "/api/installation/bot",
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.guildDirectory.inspectBotToken).toHaveBeenCalledWith("rotated-token");
    expect(dependencies.settings.rotateDiscordBot).toHaveBeenCalledWith(
      "application-1",
      "rotated-token",
    );
    await app.close();
  });

  it("returns a conflict when a recording blocks bot rotation", async () => {
    const dependencies = createDependencies("local");
    vi.mocked(dependencies.settings.rotateDiscordBot).mockRejectedValue(
      new DiscordBotRotationError("active_recording"),
    );
    const app = await createApiServer(dependencies);

    const response = await app.inject({
      headers: localOrigin,
      method: "PUT",
      payload: { discordBotToken: "rotated-token" },
      url: "/api/installation/bot",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "active_recording" });
    expect(response.body).not.toContain("rotated-token");
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
      headers: localOrigin,
      method: "PATCH",
      payload: { completed: true },
      url: `/api/guilds/guild-1/tasks/${taskId}/completion`,
    });

    expect(response.statusCode).toBe(204);
    expect(dependencies.tasks.setCompleted).toHaveBeenCalledWith("guild-1", taskId, null, true);
    await app.close();
  });

  it("does not expose the removed Summyz account routes", async () => {
    const app = await createApiServer(createDependencies("local"));
    const removed = await Promise.all(
      [
        "/api/auth/register",
        "/api/auth/login",
        "/api/auth/forgot-password",
        "/api/auth/change-password",
        "/api/auth/discord",
        "/api/setup/discord",
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

function modelDependencies(): NonNullable<ApiServerDependencies["models"]> {
  const job = {
    downloadId: "63d3b8c0-e02a-4fdf-8179-a0feec79e7c1",
    provider: "ollama" as const,
    model: "qwen3:8b",
    status: "queued" as const,
    completedBytes: 0,
    totalBytes: null,
    partialDigests: [],
    failureCode: null,
  };
  return {
    inventory: {
      assess: vi.fn(async () => ({
        status: "ready" as const,
        missingModels: [],
        unavailableProviders: [],
      })),
    },
    catalog: {
      validateProfile: vi.fn(async () => {}),
      list: vi.fn(async (query) => ({
        ...query,
        status: "fresh" as const,
        fetchedAt: 0,
        items: [],
        inventoryStatus: "available" as const,
      })),
    },
    management: {
      download: vi.fn(async () => job),
      remove: vi.fn(async () => {}),
      downloads: {
        cancel: vi.fn(async () => {}),
        store: {
          list: vi.fn(async () => [job]),
          get: vi.fn(async () => job),
          create: vi.fn(async () => job),
          update: vi.fn(async () => {}),
        },
      },
    },
  };
}

function createDependencies(accessMode: "local" | "public"): ApiServerDependencies {
  const profile = createInitialAiProfile("external", "pt-BR");
  return {
    accessMode,
    models: modelDependencies(),
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
      authenticate: vi.fn(async () => undefined),
      create: vi.fn(async () => "session-token"),
      logout: vi.fn(async () => undefined),
    },
    discordConnection: {
      cancelAuthorization: vi.fn(async () => undefined),
      completeAuthorization: vi.fn(async () => undefined),
      createAuthorizationUrl: vi.fn(async () => "https://discord.com/oauth2/authorize"),
      getConnectedUserId: vi.fn(async () => "owner-a"),
      getConnectionProfile: vi.fn(async () => ({
        avatarUrl: null,
        connected: true as const,
        discordUserId: "owner-a",
        discordUsername: "Owner A",
      })),
      getConnectionStatus: vi.fn(async () => ({
        connected: true as const,
        discordUserId: "owner-a",
        discordUsername: "Owner A",
      })),
      listOwnedGuilds: vi.fn(async () => [{ iconUrl: null, id: "guild-1", name: "Equipe" }]),
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
    guildHistory: {
      hasMeetings: vi.fn(async (guildId: string) => guildId === "guild-1"),
      list: vi.fn(async () => [{ iconUrl: null, id: "guild-1", name: "Equipe" }]),
    },
    guildOwnerApprovals: {
      confirm: vi.fn(async () => true),
      isConfirmed: vi.fn(async () => true),
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
      rotateDiscordBot: vi.fn(async () => "rotated" as const),
      getSettings: vi.fn(async () => ({
        discordApplicationId: null,
        secrets: { discordBotToken: false, discordClientSecret: false, openRouterApiKey: false },
        setupCompleted: false,
      })),
      removeSecret: vi.fn(async () => undefined),
      setSecret: vi.fn(async () => undefined),
    },
    setupToken: "setup-token-value-with-at-least-32-chars",
    tasks: {
      list: vi.fn(async () => []),
      setCompleted: vi.fn(async () => undefined),
    },
  };
}

function analyticsDependencies(): NonNullable<ApiServerDependencies["analytics"]> {
  const cost = {
    attemptCounts: { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 },
    breakdown: [],
    confirmed: [],
  };
  return {
    getDashboard: vi.fn<NonNullable<ApiServerDependencies["analytics"]>["getDashboard"]>(
      async () => ({
        averageDurationMs: 0,
        calls: { current: 0, deltaPercentage: null, previous: null },
        cost: { confirmed: [], stages: [] },
        openTaskCount: 0,
        period: "90d",
        statusSeries: [],
        topSpeakers: [],
        totalCalls: 0,
        totalDurationMs: 0,
      }),
    ),
    getCostDetail: vi.fn<NonNullable<ApiServerDependencies["analytics"]>["getCostDetail"]>(
      async () => ({
        attemptCounts: cost.attemptCounts,
        confirmed: [],
        meetingCount: 0,
        models: [],
        stages: [],
        topMeetings: [],
      }),
    ),
    getGuildCallCount: vi.fn(async () => 0),
    listMeetings: vi.fn(async () => ({ items: [], page: 1, pageSize: 20, total: 0 })),
    getMeeting: vi.fn<NonNullable<ApiServerDependencies["analytics"]>["getMeeting"]>(async () => ({
      aiProfile: null,
      audioRetained: false,
      completedAt: "2026-09-29T02:31:00.000Z",
      contentRetained: true,
      cost,
      discordUrl: null,
      durationMs: 60000,
      failureCode: null,
      meetingId: "meeting-1",
      participants: [],
      pipelineStatus: "completed",
      rawTranscript: null,
      startedAt: "2026-09-29T02:30:00.000Z",
      voiceChannelName: "Planejamento",
      transcript: "[00:05] Ana: Vamos publicar amanhã.",
      summary: {
        status: "completed",
        language: "en",
        executiveSummary: "The release was approved.",
        decisions: [],
        discussedTopics: [],
        observations: [],
        tasks: [{ text: "Publish", deadlineText: "amanhã" }],
      },
    })),
    updateDisplayNames: vi.fn(async () => undefined),
    updateParticipantProfiles: vi.fn(async () => undefined),
  };
}
