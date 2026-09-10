import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { z } from "zod";

import { aiProfileSchema, localizeAiProfileDefaults } from "../ai-profile.js";
import { memberDirectoryPageQuerySchema } from "../directory-pagination.js";
import type { RecordingUserGrant } from "../guild-config-store.js";
import { registerAnalyticsRoutes } from "./server-analytics-routes.js";
import { registerAuthRoutes } from "./server-auth-routes.js";
import { registerSetupRoutes } from "./server-setup-routes.js";
import {
  type ApiServerDependencies,
  guildSettingsSchema,
  profileBodySchema,
  profileParametersSchema,
} from "./server-contracts.js";
import {
  authorizeDashboard,
  authorizeGuild,
  createGuildAccessResolver,
  getErrorStatusCode,
  getKnownApiError,
  logApiFailure,
  runApiDependency,
  setSessionCookie,
  wasRequestAuthenticated,
} from "./server-support.js";

export type { ApiServerDependencies, GuildDirectory } from "./server-contracts.js";

type InstalledGuild = Awaited<
  ReturnType<ApiServerDependencies["guildDirectory"]["listInstalledGuilds"]>
>[number];

const loadGuildForums = async (dependencies: ApiServerDependencies, guildId: string) => {
  if (dependencies.guildDirectory.getForums !== undefined) {
    return dependencies.guildDirectory.getForums(guildId);
  }
  return dependencies.guildDirectory.getResources(guildId).then((resources) => resources.forums);
};

const enrichInstalledGuild = async (guild: InstalledGuild, dependencies: ApiServerDependencies) => {
  if (dependencies.analytics === undefined) {
    return { ...guild, activeProfile: null, callCount: null, summaryForum: null };
  }
  const [activeProfile, callCount, summaryForumConfiguration, forums] = await Promise.all([
    dependencies.aiProfiles.getActiveProfile(guild.id),
    dependencies.analytics.getGuildCallCount(guild.id),
    dependencies.guildConfig.getSummaryForum(guild.id),
    loadGuildForums(dependencies, guild.id),
  ]);
  const forum = forums.find((item) => item.id === summaryForumConfiguration?.forumId);
  const tag = forum?.tags.find((item) => item.id === summaryForumConfiguration?.tagId);
  return {
    ...guild,
    activeProfile:
      activeProfile === undefined
        ? null
        : {
            name: activeProfile.name,
            profileId: activeProfile.profileId,
            profileType: activeProfile.profileType,
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
};

export async function createApiServer(
  dependencies: ApiServerDependencies,
  options: { staticDirectory?: string } = {},
) {
  const app = Fastify({
    logger: false,
    trustProxy: dependencies.accessMode === "public" ? "loopback, linklocal, uniquelocal" : false,
  });
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
  app.addHook("onRequest", async (request, reply) => {
    if (
      dependencies.accessMode === "public" &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin !== dependencies.publicBaseUrl
    ) {
      return reply.status(403).send({ error: "invalid_origin" });
    }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const sessionToken = request.cookies.summyz_session;
    if (
      sessionToken !== undefined &&
      wasRequestAuthenticated(request) &&
      !reply.hasHeader("set-cookie")
    ) {
      setSessionCookie(reply, sessionToken);
    }
    return payload;
  });
  if (options.staticDirectory !== undefined) {
    await app.register(staticFiles, { root: options.staticDirectory });
  }

  app.setErrorHandler((error, request, reply) => {
    const knownError = getKnownApiError(error);
    if (knownError !== undefined) {
      if (knownError.retryAfterSeconds !== undefined) {
        reply.header("retry-after", knownError.retryAfterSeconds);
      }
      void reply.status(knownError.statusCode).send(knownError.body);
      return;
    }
    const statusCode = getErrorStatusCode(error);
    const message = error instanceof Error ? error.message : "internal_error";
    if (statusCode >= 500) logApiFailure(dependencies.logger, request, error);
    void reply.status(statusCode).send({ error: statusCode >= 500 ? "internal_error" : message });
  });

  app.get("/api/health", async () => ({ status: "ok" }));
  registerSetupRoutes(app, dependencies);
  registerAuthRoutes(app, dependencies);

  app.get("/api/guilds", async (request) => {
    await authorizeDashboard(request, dependencies);
    const guilds = await resolveGuildAccess();
    return Promise.all(guilds.map((guild) => enrichInstalledGuild(guild, dependencies)));
  });
  app.get("/api/installation/bot", async (request) => {
    await authorizeDashboard(request, dependencies);
    const settings = await dependencies.settings.getSettings();
    if (settings.discordApplicationId === null) return { configured: false };
    const parameters = new URLSearchParams({
      client_id: settings.discordApplicationId,
      permissions: "326417521664",
      scope: "bot applications.commands",
    });
    return {
      applicationId: settings.discordApplicationId,
      configured: true,
      installUrl: `https://discord.com/oauth2/authorize?${parameters}`,
    };
  });
  app.put("/api/installation/bot", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const { discordBotToken } = z
      .object({ discordBotToken: z.string().min(1) })
      .parse(request.body);
    const application = await dependencies.guildDirectory.inspectBotToken(discordBotToken);
    await dependencies.settings.configureDiscordBot(application.id, discordBotToken);
    return reply.status(204).send();
  });
  registerAnalyticsRoutes(app, dependencies, resolveGuildAccess);
  app.get("/api/guilds/:guildId/configuration", async (request) => {
    const { access, guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const [settings, recordingPermissions, summaryForum, profiles, activeProfile] =
      await runApiDependency("database", "load_guild_configuration", async () => {
        return Promise.all([
          dependencies.guildConfig.getGuildSettings(guildId),
          dependencies.guildConfig.getRecordingPermissions(guildId),
          dependencies.guildConfig.getSummaryForum(guildId),
          dependencies.aiProfiles.listProfiles(),
          dependencies.aiProfiles.getActiveProfile(guildId),
        ]);
      });
    const activeProfileId =
      activeProfile !== undefined &&
      profiles.some((profile) => profile.profileId === activeProfile.profileId)
        ? activeProfile.profileId
        : null;
    if (activeProfile !== undefined && activeProfileId === null) {
      await runApiDependency("database", "clear_stale_active_profile", () =>
        dependencies.aiProfiles.clearActiveProfile(guildId),
      );
    }
    const currentGrantedMembers = await runApiDependency(
      "discord",
      "validate_recording_user_grants",
      () =>
        dependencies.guildDirectory.getMembersByIds(
          guildId,
          recordingPermissions.userGrants.map((grant) => grant.userId),
        ),
    );
    const validUserGrants: RecordingUserGrant[] = [];
    for (const grant of recordingPermissions.userGrants) {
      if (currentGrantedMembers.get(grant.userId)?.joinedAt === grant.memberJoinedAt) {
        validUserGrants.push(grant);
      } else {
        await runApiDependency("database", "remove_stale_recording_user_grant", () =>
          dependencies.guildConfig.removeRecordingUser(guildId, grant.userId),
        );
      }
    }
    return {
      activeProfileId,
      profiles: profiles.map((profile) =>
        localizeAiProfileDefaults(profile, access.dashboardLanguage),
      ),
      recordingRoleIds: recordingPermissions.roleIds,
      recordingUserIds: validUserGrants.map((grant) => grant.userId),
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
  app.get("/api/guilds/:guildId/members", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const query = memberDirectoryPageQuerySchema.parse(request.query);
    return runApiDependency("discord", "list_guild_members", () =>
      dependencies.guildDirectory.listMembers(guildId, {
        page: query.page,
        pageSize: 50,
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.roleId === undefined ? {} : { roleId: query.roleId }),
      }),
    );
  });
  app.put("/api/guilds/:guildId/recording-permissions", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const body = z
      .object({
        roleIds: z.array(z.string().min(1).max(128)).max(1_000),
        userIds: z.array(z.string().min(1).max(128)).max(1_000),
      })
      .parse(request.body);
    const roleIds = [...new Set(body.roleIds)];
    const userIds = [...new Set(body.userIds)];
    const members = await runApiDependency("discord", "validate_recording_members", () =>
      dependencies.guildDirectory.getMembersByIds(guildId, userIds),
    );
    const userGrants: RecordingUserGrant[] = [];
    for (const userId of userIds) {
      const member = members.get(userId);
      if (member === undefined) {
        return reply.status(400).send({ error: "recording_member_not_found" });
      }
      userGrants.push({ memberJoinedAt: member.joinedAt, userId });
    }
    await runApiDependency("database", "set_recording_permissions", () =>
      dependencies.guildConfig.setRecordingPermissions(guildId, {
        roleIds,
        userGrants,
      }),
    );
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
    const access = await authorizeDashboard(request, dependencies);
    const [profiles, activeProfileCounts] = await runApiDependency(
      "database",
      "list_ai_profiles",
      async () => {
        return Promise.all([
          dependencies.aiProfiles.listProfiles(),
          dependencies.aiProfiles.listActiveProfileCounts(),
        ]);
      },
    );
    return profiles.map((profile) => ({
      active: (activeProfileCounts.get(profile.profileId) ?? 0) > 0,
      activeServerCount: activeProfileCounts.get(profile.profileId) ?? 0,
      profile: localizeAiProfileDefaults(profile, access.dashboardLanguage),
    }));
  });
  app.post("/api/profiles", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const profile = aiProfileSchema.parse({
      ...profileBodySchema.parse(request.body),
      profileId: randomUUID(),
    });
    await dependencies.aiProfiles.createProfile(profile);
    return reply.status(201).send(profile);
  });
  app.put("/api/profiles/:profileId", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const parameters = profileParametersSchema.parse(request.params);
    const profile = aiProfileSchema.parse({
      ...profileBodySchema.parse(request.body),
      profileId: parameters.profileId,
    });
    await dependencies.aiProfiles.updateProfile(profile);
    return reply.status(204).send();
  });
  app.delete("/api/profiles/:profileId", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const parameters = profileParametersSchema.parse(request.params);
    await dependencies.aiProfiles.deleteProfile(parameters.profileId);
    return reply.status(204).send();
  });
  app.put("/api/guilds/:guildId/profiles/:profileId/active", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { profileId } = profileParametersSchema.parse(request.params);
    await dependencies.aiProfiles.setActiveProfile(guildId, profileId);
    return reply.status(204).send();
  });

  app.get("/api/installation/settings", async (request) => {
    await authorizeDashboard(request, dependencies);
    return dependencies.settings.getSettings();
  });
  app.get("/api/installation/health", async (request) => {
    await authorizeDashboard(request, dependencies);
    const [health, settings] = await Promise.all([
      dependencies.health.getStatus(),
      dependencies.settings.getSettings(),
    ]);
    return {
      ...health,
      externalConfiguration: {
        openRouterConfigured: settings.secrets.openRouterApiKey,
      },
    };
  });
  app.put("/api/installation/secrets/:secretName", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const parameters = z
      .object({
        secretName: z.enum(["openrouter_api_key"]),
      })
      .parse(request.params);
    const body = z.object({ value: z.string().min(1) }).parse(request.body);
    await dependencies.settings.setSecret(parameters.secretName, body.value);
    return reply.status(204).send();
  });
  app.delete("/api/installation/secrets/:secretName", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const parameters = z
      .object({
        secretName: z.enum(["openrouter_api_key"]),
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
