import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { z, ZodError } from "zod";

import { aiProfileSchema, externalAiProfileSchema, localAiProfileSchema } from "../ai-profile.js";
import { createDefaultAiPrompts } from "../ai-prompts.js";
import type { AuthenticatedUser } from "../auth/auth-domain.js";
import type { AuthTokens, StoredDashboardUser } from "../auth/auth-service.js";
import { AuthenticationError } from "../auth/auth-service.js";
import { SessionTokenError } from "../auth/jwt-session.js";
import {
  type AiProfileStore,
  StoredAiProfileValidationError,
} from "../database/postgres-ai-profile-store.js";
import type {
  InstallationSecretName,
  InstallationSettings,
} from "../database/postgres-installation-settings-store.js";
import { installationSettingsInputSchema } from "../database/postgres-installation-settings-store.js";
import type {
  DiscordConnectionStatus,
  OwnedDiscordGuild,
} from "../discord/discord-oauth-service.js";
import type { GuildConfigurationStore } from "../guild-config-store.js";
import type {
  DashboardAnalytics,
  MeetingHistoryDetail,
  MeetingHistoryFilters,
  MeetingHistoryPage,
} from "../database/postgres-analytics-store.js";

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1).max(1_024) });
const registrationSchema = credentialsSchema.extend({
  dashboardLanguage: z.enum(["en", "pt-BR"]),
});
const setupSchema = z
  .object({
    administrator: registrationSchema,
    installation: installationSettingsInputSchema.extend({
      secrets: z.object({
        discordBotToken: z.string().min(1),
        discordClientSecret: z.string().min(1),
        openRouterApiKey: z.string().min(1).optional(),
        smtpPassword: z.string().min(1).optional(),
      }),
    }),
  })
  .superRefine((setup, context) => {
    if (
      setup.installation.registrationEnabled &&
      (setup.installation.smtp === null || setup.installation.secrets.smtpPassword === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "SMTP is required while public registration is enabled",
        path: ["installation", "smtp"],
      });
    }
  });
const guildSettingsSchema = z.object({
  botLanguage: z.enum(["en", "pt-BR"]),
  persistMeetingAudio: z.boolean(),
  persistMeetingContent: z.boolean(),
});
const guildParametersSchema = z.object({ guildId: z.string().min(1).max(128) });
const profileParametersSchema = z.object({ profileId: z.string().min(1).max(256) });
const profileBodySchema = z.discriminatedUnion("profileType", [
  externalAiProfileSchema.omit({ profileId: true, userId: true }),
  localAiProfileSchema.omit({ profileId: true, userId: true }),
]);

interface ApiAuthService {
  authenticate(accessToken: string): Promise<AuthenticatedUser>;
  createInitialAdministrator(
    input: z.infer<typeof registrationSchema>,
  ): Promise<StoredDashboardUser>;
  login(email: string, password: string): Promise<AuthTokens>;
  logout(accessToken: string): Promise<void>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  register(input: z.infer<typeof registrationSchema>): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
}

interface ApiSettingsStore {
  completeSetup(): Promise<void>;
  getSettings(): Promise<InstallationSettings>;
  removeSecret(name: InstallationSecretName): Promise<void>;
  setSecret(name: InstallationSecretName, value: string): Promise<void>;
  updateSettings(input: z.input<typeof installationSettingsInputSchema>): Promise<void>;
}

interface ApiDiscordService {
  completeAuthorization(userId: string, code: string, state: string): Promise<void>;
  createAuthorizationUrl(userId: string): Promise<string>;
  disconnect(userId: string): Promise<void>;
  getConnectionStatus(userId: string): Promise<DiscordConnectionStatus>;
  listOwnedGuilds(
    userId: string,
    installedGuildIds: ReadonlySet<string>,
  ): Promise<OwnedDiscordGuild[]>;
}

export interface GuildDirectory {
  getInstalledGuildIds(): Promise<ReadonlySet<string>>;
  getResources(guildId: string): Promise<{
    forums: { id: string; name: string; tags: { id: string; name: string }[] }[];
    roles: { id: string; name: string }[];
  }>;
  getMemberDisplayNames?(
    guildId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}

interface ApiAnalyticsStore {
  getDashboard(guildId: string): Promise<DashboardAnalytics>;
  getMeeting(guildId: string, meetingId: string): Promise<MeetingHistoryDetail | undefined>;
  listMeetings(guildId: string, filters: MeetingHistoryFilters): Promise<MeetingHistoryPage>;
  updateDisplayNames(guildId: string, names: ReadonlyMap<string, string>): Promise<void>;
}

export interface ApiServerDependencies {
  analytics?: ApiAnalyticsStore;
  aiProfiles: AiProfileStore;
  auth: ApiAuthService;
  discord: ApiDiscordService;
  guildConfig: GuildConfigurationStore;
  guildDirectory: GuildDirectory;
  logger: Logger;
  secureCookies: boolean;
  settings: ApiSettingsStore;
  setupToken: string;
  timeZone?: string;
}

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

  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const settings = await dependencies.settings.getSettings();
      if (!settings.setupCompleted || !settings.registrationEnabled) {
        return reply.status(403).send({ error: "registration_disabled" });
      }
      await dependencies.auth.register(registrationSchema.parse(request.body));
      return reply.status(202).send();
    },
  );
  app.post("/api/auth/verify", async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).parse(request.body);
    await dependencies.auth.verifyEmail(body.token);
    return reply.status(204).send();
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const credentials = credentialsSchema.parse(request.body);
      const tokens = await dependencies.auth.login(credentials.email, credentials.password);
      setSessionCookies(reply, tokens, dependencies.secureCookies);
      return reply.status(204).send();
    },
  );
  app.post("/api/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies.summyz_refresh;
    if (refreshToken === undefined) return reply.status(401).send({ error: "session_expired" });
    const tokens = await dependencies.auth.refresh(refreshToken);
    setSessionCookies(reply, tokens, dependencies.secureCookies);
    return reply.status(204).send();
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const accessToken = request.cookies.summyz_access;
    if (accessToken !== undefined) await dependencies.auth.logout(accessToken);
    clearSessionCookies(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });
  app.post("/api/auth/forgot-password", async (request, reply) => {
    const body = z.object({ email: z.email() }).parse(request.body);
    await dependencies.auth.requestPasswordReset(body.email);
    return reply.status(202).send();
  });
  app.post("/api/auth/reset-password", async (request, reply) => {
    const body = z
      .object({ password: z.string().min(1), token: z.string().min(1) })
      .parse(request.body);
    await dependencies.auth.resetPassword(body.token, body.password);
    return reply.status(204).send();
  });
  app.get("/api/auth/me", async (request) => authenticateRequest(request, dependencies));

  app.get("/api/ai/prompts/defaults", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    const { summaryLanguage } = z
      .object({ summaryLanguage: z.string().min(1).max(32) })
      .parse(request.query);
    return createDefaultAiPrompts(user.dashboardLanguage, summaryLanguage);
  });

  app.get("/api/discord/connect", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return { authorizationUrl: await dependencies.discord.createAuthorizationUrl(user.userId) };
  });
  app.get("/api/discord/callback", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const query = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .parse(request.query);
    await dependencies.discord.completeAuthorization(user.userId, query.code, query.state);
    return reply.redirect("/account?discord=connected");
  });
  app.get("/api/discord/connection", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return dependencies.discord.getConnectionStatus(user.userId);
  });
  app.delete("/api/discord/connection", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    await dependencies.discord.disconnect(user.userId);
    return reply.status(204).send();
  });

  app.get("/api/guilds", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return dependencies.discord.listOwnedGuilds(
      user.userId,
      await dependencies.guildDirectory.getInstalledGuildIds(),
    );
  });
  app.get("/api/guilds/:guildId/dashboard", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const analytics = requireAnalytics(dependencies);
    const dashboard = await analytics.getDashboard(guildId);
    const names = await refreshDisplayNames(
      guildId,
      dashboard.topSpeakers.map((speaker) => speaker.userId),
      dependencies,
    );
    return {
      ...dashboard,
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
      topSpeakers: dashboard.topSpeakers.map((speaker) => ({
        ...speaker,
        displayName: names.get(speaker.userId) ?? speaker.displayName,
      })),
    };
  });
  app.get("/api/guilds/:guildId/meetings", async (request) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const query = z
      .object({
        dateFrom: z.iso.date().optional(),
        dateTo: z.iso.date().optional(),
        meetingId: z.string().trim().min(1).max(128).optional(),
        page: z.coerce.number().int().positive().default(1),
        state: z.enum(["completed", "failed", "in_progress"]).optional(),
      })
      .parse(request.query);
    const analytics = requireAnalytics(dependencies);
    const history = await analytics.listMeetings(
      guildId,
      query.meetingId === undefined
        ? {
            ...(query.dateFrom === undefined ? {} : { dateFrom: query.dateFrom }),
            ...(query.dateTo === undefined ? {} : { dateTo: query.dateTo }),
            pageSize: 20,
            page: query.page,
            ...(query.state === undefined ? {} : { state: query.state }),
            timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
          }
        : {
            meetingId: query.meetingId,
            pageSize: 20,
            page: query.page,
            timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
          },
    );
    const userIds = history.items.flatMap(
      (meeting) => meeting.participants?.map((item) => item.userId) ?? [],
    );
    const names = await refreshDisplayNames(guildId, userIds, dependencies);
    return {
      ...history,
      items: history.items.map((meeting) => ({
        ...meeting,
        participants:
          meeting.participants?.map((participant) => ({
            ...participant,
            displayName: names.get(participant.userId) ?? participant.displayName,
          })) ?? null,
      })),
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
    };
  });
  app.get("/api/guilds/:guildId/meetings/:meetingId", async (request, reply) => {
    const { guildId } = await authorizeGuild(request, dependencies, resolveGuildAccess);
    const { meetingId } = z.object({ meetingId: z.string().min(1).max(128) }).parse(request.params);
    const analytics = requireAnalytics(dependencies);
    const meeting = await analytics.getMeeting(guildId, meetingId);
    if (meeting === undefined) return reply.status(404).send({ error: "meeting_not_found" });
    const names = await refreshDisplayNames(
      guildId,
      meeting.participants?.map((participant) => participant.userId) ?? [],
      dependencies,
    );
    return {
      ...meeting,
      participants:
        meeting.participants?.map((participant) => ({
          ...participant,
          displayName: names.get(participant.userId) ?? participant.displayName,
        })) ?? null,
      timeZone: dependencies.timeZone ?? "America/Sao_Paulo",
    };
  });
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
      profiles,
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
    const [profiles, activeProfileIds] = await runApiDependency(
      "database",
      "list_ai_profiles",
      async () => {
        await dependencies.aiProfiles.ensureInitialProfiles(user.userId, user.dashboardLanguage);
        return Promise.all([
          dependencies.aiProfiles.listProfiles(user.userId),
          dependencies.aiProfiles.listActiveProfileIds(user.userId),
        ]);
      },
    );
    return profiles.map((profile) => ({
      active: activeProfileIds.has(profile.profileId),
      profile,
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

async function authenticateRequest(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<AuthenticatedUser> {
  const accessToken = request.cookies.summyz_access;
  if (accessToken === undefined) throw new AuthenticationError("session_expired");
  return dependencies.auth.authenticate(accessToken);
}

async function authorizeGuild(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
  resolveGuildAccess: GuildAccessResolver,
): Promise<{ guildId: string; user: AuthenticatedUser }> {
  const user = await authenticateRequest(request, dependencies);
  const { guildId } = guildParametersSchema.parse(request.params);
  const guilds = await resolveGuildAccess(user.userId);
  if (!guilds.some((guild) => guild.id === guildId && guild.installed)) {
    const error = new Error("guild_access_denied") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
  return { guildId, user };
}

type GuildAccessResolver = (userId: string) => Promise<readonly OwnedDiscordGuild[]>;

function createGuildAccessResolver(dependencies: ApiServerDependencies): GuildAccessResolver {
  const cache = new Map<
    string,
    { expiresAt: number; request: Promise<readonly OwnedDiscordGuild[]> }
  >();
  return async (userId) => {
    const now = Date.now();
    const cached = cache.get(userId);
    if (cached !== undefined && cached.expiresAt > now) return cached.request;
    const request = runApiDependency("discord", "resolve_guild_access", async () => {
      const installedGuildIds = await dependencies.guildDirectory.getInstalledGuildIds();
      return dependencies.discord.listOwnedGuilds(userId, installedGuildIds);
    });
    cache.set(userId, { expiresAt: now + 10_000, request });
    try {
      return await request;
    } catch (error) {
      if (cache.get(userId)?.request === request) cache.delete(userId);
      throw error;
    }
  };
}

type ApiErrorCategory = "database" | "discord" | "persisted_data";

class ApiDependencyError extends Error {
  public constructor(
    public readonly errorCategory: ApiErrorCategory,
    public readonly operation: string,
    cause: unknown,
  ) {
    super("Dashboard dependency failed", { cause });
    this.name = "ApiDependencyError";
  }
}

async function runApiDependency<T>(
  errorCategory: Exclude<ApiErrorCategory, "persisted_data">,
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ApiDependencyError) throw error;
    throw new ApiDependencyError(
      error instanceof StoredAiProfileValidationError ? "persisted_data" : errorCategory,
      operation,
      error,
    );
  }
}

function logApiFailure(logger: Logger, request: FastifyRequest, error: unknown): void {
  const dependencyError = error instanceof ApiDependencyError ? error : undefined;
  logger.error(
    {
      errorCategory: dependencyError?.errorCategory ?? "internal",
      errorType: getErrorType(dependencyError?.cause ?? error),
      method: request.method,
      operation: dependencyError?.operation ?? "handle_request",
      requestId: request.id,
      route: request.routeOptions.url,
    },
    "Dashboard request failed",
  );
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function requireAdministrator(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<AuthenticatedUser> {
  const user = await authenticateRequest(request, dependencies);
  if (user.installationRole !== "administrator") {
    const error = new Error("administrator_required") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
  return user;
}

function setSessionCookies(reply: FastifyReply, tokens: AuthTokens, secure: boolean): void {
  const common = { httpOnly: true, path: "/", sameSite: "lax" as const, secure };
  reply.setCookie("summyz_access", tokens.accessToken, { ...common, maxAge: 15 * 60 });
  reply.setCookie("summyz_refresh", tokens.refreshToken, { ...common, maxAge: 30 * 24 * 60 * 60 });
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  const options = { httpOnly: true, path: "/", sameSite: "lax" as const, secure };
  reply.clearCookie("summyz_access", options);
  reply.clearCookie("summyz_refresh", options);
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function getErrorStatusCode(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return 500;
}

function requireAnalytics(dependencies: ApiServerDependencies): ApiAnalyticsStore {
  if (dependencies.analytics === undefined)
    throw new Error("Dashboard analytics are not configured");
  return dependencies.analytics;
}

async function refreshDisplayNames(
  guildId: string,
  userIds: readonly string[],
  dependencies: ApiServerDependencies,
): Promise<ReadonlyMap<string, string>> {
  if (dependencies.guildDirectory.getMemberDisplayNames === undefined || userIds.length === 0) {
    return new Map();
  }
  const names = await dependencies.guildDirectory
    .getMemberDisplayNames(guildId, userIds)
    .catch(() => new Map<string, string>());
  await dependencies.analytics?.updateDisplayNames(guildId, names);
  return names;
}
