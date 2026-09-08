import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { ZodError, z } from "zod";

import { aiProfileSchema, localizeAiProfileDefaults } from "../ai-profile.js";
import { AuthenticationError } from "../auth/auth-service.js";
import { SessionTokenError } from "../auth/jwt-session.js";
import { installationSettingsInputSchema } from "../database/postgres-installation-settings-store.js";
import { registerAnalyticsRoutes } from "./server-analytics-routes.js";
import { registerAuthRoutes } from "./server-auth-routes.js";
import {
  type ApiServerDependencies,
  guildSettingsSchema,
  profileBodySchema,
  profileParametersSchema,
  setupSchema,
} from "./server-contracts.js";
import {
  authenticateRequest,
  authorizeGuild,
  createGuildAccessResolver,
  getErrorStatusCode,
  logApiFailure,
  requireAdministrator,
  runApiDependency,
  safeEqual,
} from "./server-support.js";

export type { ApiServerDependencies, GuildDirectory } from "./server-contracts.js";
export async function createApiServer(
  dependencies: ApiServerDependencies,
  options: { staticDirectory?: string } = {},
) {
  const app = Fastify({ logger: false });
  const resolveGuildAccess = createGuildAccessResolver(dependencies);
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'self'"],
        defaultSrc: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        objectSrc: ["'none'"],
      },
    },
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  if (options.staticDirectory !== undefined) {
    await app.register(staticFiles, { root: options.staticDirectory });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      void reply.status(400).send({ error: "invalid_request", issues: error.issues });
      return;
    }
    if (error instanceof AuthenticationError) {
      void reply.status(401).send({ error: error.code });
      return;
    }
    if (error instanceof SessionTokenError) {
      void reply.status(401).send({ error: "session_expired" });
      return;
    }
    const statusCode = getErrorStatusCode(error);
    const message = error instanceof Error ? error.message : "internal_error";
    if (statusCode >= 500) logApiFailure(dependencies.logger, request, error);
    void reply.status(statusCode).send({ error: statusCode >= 500 ? "internal_error" : message });
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/setup/status", async () => {
    const settings = await dependencies.settings.getSettings();
    return {
      registrationEnabled: settings.registrationEnabled,
      setupCompleted: settings.setupCompleted,
    };
  });
  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const current = await dependencies.settings.getSettings();
      if (current.setupCompleted)
        return reply.status(409).send({ error: "setup_already_completed" });
      const suppliedToken = z.string().parse(request.headers["x-summyz-setup-token"]);
      if (!safeEqual(suppliedToken, dependencies.setupToken)) {
        return reply.status(403).send({ error: "invalid_setup_token" });
      }
      const setup = setupSchema.parse(request.body);
      await dependencies.auth.createInitialAdministrator(setup.administrator);
      const { secrets, ...settings } = setup.installation;
      await dependencies.settings.updateSettings(settings);
      await dependencies.settings.setSecret("discord_bot_token", secrets.discordBotToken);
      await dependencies.settings.setSecret("discord_client_secret", secrets.discordClientSecret);
      if (secrets.openRouterApiKey !== undefined) {
        await dependencies.settings.setSecret("openrouter_api_key", secrets.openRouterApiKey);
      }
      if (secrets.smtpPassword !== undefined) {
        await dependencies.settings.setSecret("smtp_password", secrets.smtpPassword);
      }
      await dependencies.settings.completeSetup();
      return reply.status(204).send();
    },
  );

  registerAuthRoutes(app, dependencies);

  app.get("/api/guilds", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    const guilds = await dependencies.discord.listOwnedGuilds(
      user.userId,
      await dependencies.guildDirectory.getInstalledGuildIds(),
    );
    return Promise.all(
      guilds.map(async (guild) => {
        if (!guild.installed || dependencies.analytics === undefined) {
          return { ...guild, activeProfile: null, callCount: null, summaryForum: null };
        }
        const [activeProfile, callCount, summaryForumConfiguration, forums] = await Promise.all([
          dependencies.aiProfiles.getActiveProfile(guild.id),
          dependencies.analytics.getGuildCallCount(guild.id),
          dependencies.guildConfig.getSummaryForum(guild.id),
          dependencies.guildDirectory.getForums === undefined
            ? dependencies.guildDirectory
                .getResources(guild.id)
                .then((resources) => resources.forums)
            : dependencies.guildDirectory.getForums(guild.id),
        ]);
        const forum = forums.find((item) => item.id === summaryForumConfiguration?.forumId);
        const tag = forum?.tags.find((item) => item.id === summaryForumConfiguration?.tagId);
        const ownedActiveProfile =
          activeProfile?.userId === user.userId ? activeProfile : undefined;
        return {
          ...guild,
          activeProfile:
            ownedActiveProfile === undefined
              ? null
              : {
                  name: ownedActiveProfile.name,
                  profileId: ownedActiveProfile.profileId,
                  profileType: ownedActiveProfile.profileType,
                },
          callCount,
          summaryForum:
            forum === undefined
              ? null
              : {
                  forumId: forum.id,
                  name: forum.name,
                  ...(tag === undefined ? {} : { tagId: tag.id, tagName: tag.name }),
                },
        };
      }),
    );
  });
  registerAnalyticsRoutes(app, dependencies, resolveGuildAccess);
  app.get("/api/guilds/:guildId/configuration", async (request) => {
    const { guildId, user } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const [settings, recordingRoleIds, summaryForum, profiles, activeProfile] =
      await runApiDependency("database", "load_guild_configuration", async () => {
        await dependencies.aiProfiles.ensureInitialProfiles(user.userId, user.dashboardLanguage);
        return Promise.all([
          dependencies.guildConfig.getGuildSettings(guildId),
          dependencies.guildConfig.listRecordingRoles(guildId),
          dependencies.guildConfig.getSummaryForum(guildId),
          dependencies.aiProfiles.listProfiles(user.userId),
          dependencies.aiProfiles.getActiveProfile(guildId),
        ]);
      });
    const activeProfileId =
      activeProfile?.userId === user.userId &&
      profiles.some((profile) => profile.profileId === activeProfile.profileId)
        ? activeProfile.profileId
        : null;
    if (activeProfile !== undefined && activeProfileId === null) {
      await runApiDependency("database", "clear_stale_active_profile", () =>
        dependencies.aiProfiles.clearActiveProfile(guildId),
      );
    }
    return {
      activeProfileId,
      profiles: profiles.map((profile) =>
        localizeAiProfileDefaults(profile, user.dashboardLanguage),
      ),
      recordingRoleIds,
      settings,
      summaryForum,
    };
  });
  app.put("/api/guilds/:guildId/settings", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    await dependencies.guildConfig.setGuildSettings(
      guildId,
      guildSettingsSchema.parse(request.body),
    );
    return reply.status(204).send();
  });
  app.get("/api/guilds/:guildId/resources", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    return runApiDependency("discord", "load_guild_resources", () =>
      dependencies.guildDirectory.getResources(guildId),
    );
  });
  app.put("/api/guilds/:guildId/roles", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const desired = new Set(
      z.object({ roleIds: z.array(z.string().min(1).max(128)) }).parse(request.body).roleIds,
    );
    const current = new Set(await dependencies.guildConfig.listRecordingRoles(guildId));
    await Promise.all([
      ...[...desired]
        .filter((roleId) => !current.has(roleId))
        .map((roleId) => dependencies.guildConfig.addRecordingRole(guildId, roleId)),
      ...[...current]
        .filter((roleId) => !desired.has(roleId))
        .map((roleId) => dependencies.guildConfig.removeRecordingRole(guildId, roleId)),
    ]);
    return reply.status(204).send();
  });
  app.put("/api/guilds/:guildId/forum", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const forum = z
      .object({ forumId: z.string().min(1), tagId: z.string().min(1).optional() })
      .parse(request.body);
    await dependencies.guildConfig.setSummaryForum(guildId, forum);
    return reply.status(204).send();
  });
  app.delete("/api/guilds/:guildId/forum", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    await dependencies.guildConfig.clearSummaryForum(guildId);
    return reply.status(204).send();
  });
  app.get("/api/profiles", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    const [profiles, activeProfileCounts] = await runApiDependency(
      "database",
      "list_ai_profiles",
      async () => {
        await dependencies.aiProfiles.ensureInitialProfiles(user.userId, user.dashboardLanguage);
        return Promise.all([
          dependencies.aiProfiles.listProfiles(user.userId),
          dependencies.aiProfiles.listActiveProfileCounts(user.userId),
        ]);
      },
    );
    return profiles.map((profile) => ({
      active: (activeProfileCounts.get(profile.profileId) ?? 0) > 0,
      activeServerCount: activeProfileCounts.get(profile.profileId) ?? 0,
      profile: localizeAiProfileDefaults(profile, user.dashboardLanguage),
    }));
  });
  app.post("/api/profiles", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const profile = aiProfileSchema.parse({
      ...profileBodySchema.parse(request.body),
      profileId: randomUUID(),
      userId: user.userId,
    });
    await dependencies.aiProfiles.createProfile(profile);
    return reply.status(201).send(profile);
  });
  app.put("/api/profiles/:profileId", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const parameters = profileParametersSchema.parse(request.params);
    const profile = aiProfileSchema.parse({
      ...profileBodySchema.parse(request.body),
      profileId: parameters.profileId,
      userId: user.userId,
    });
    await dependencies.aiProfiles.updateProfile(user.userId, profile);
    return reply.status(204).send();
  });
  app.delete("/api/profiles/:profileId", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const parameters = profileParametersSchema.parse(request.params);
    await dependencies.aiProfiles.deleteProfile(user.userId, parameters.profileId);
    return reply.status(204).send();
  });
  app.put("/api/guilds/:guildId/profiles/:profileId/active", async (request, reply) => {
    const { guildId, user } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { profileId } = profileParametersSchema.parse(request.params);
    await dependencies.aiProfiles.setActiveProfile(guildId, user.userId, profileId);
    return reply.status(204).send();
  });

  app.get("/api/installation/settings", async (request) => {
    await requireAdministrator(request, dependencies);
    return dependencies.settings.getSettings();
  });
  app.get("/api/installation/health", async (request) => {
    await requireAdministrator(request, dependencies);
    const [health, settings] = await Promise.all([
      dependencies.health.getStatus(),
      dependencies.settings.getSettings(),
    ]);
    return {
      ...health,
      externalConfiguration: {
        openRouterConfigured: settings.secrets.openRouterApiKey,
        smtpConfigured: settings.smtp !== null && settings.secrets.smtpPassword,
      },
    };
  });
  app.put("/api/installation/settings", async (request, reply) => {
    await requireAdministrator(request, dependencies);
    const nextSettings = installationSettingsInputSchema.parse(request.body);
    const currentSettings = await dependencies.settings.getSettings();
    if (
      nextSettings.registrationEnabled &&
      (nextSettings.smtp === null || !currentSettings.secrets.smtpPassword)
    ) {
      return reply.status(400).send({ error: "smtp_required_for_registration" });
    }
    await dependencies.settings.updateSettings(nextSettings);
    return reply.status(204).send();
  });
  app.put("/api/installation/secrets/:secretName", async (request, reply) => {
    await requireAdministrator(request, dependencies);
    const parameters = z
      .object({
        secretName: z.enum([
          "discord_bot_token",
          "discord_client_secret",
          "openrouter_api_key",
          "smtp_password",
        ]),
      })
      .parse(request.params);
    const body = z.object({ value: z.string().min(1) }).parse(request.body);
    await dependencies.settings.setSecret(parameters.secretName, body.value);
    return reply.status(204).send();
  });
  app.delete("/api/installation/secrets/:secretName", async (request, reply) => {
    await requireAdministrator(request, dependencies);
    const parameters = z
      .object({
        secretName: z.enum([
          "discord_bot_token",
          "discord_client_secret",
          "openrouter_api_key",
          "smtp_password",
        ]),
      })
      .parse(request.params);
    await dependencies.settings.removeSecret(parameters.secretName);
    return reply.status(204).send();
  });

  if (options.staticDirectory !== undefined) {
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
