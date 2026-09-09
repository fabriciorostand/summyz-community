import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import type { AuthenticatedUser } from "../auth/auth-domain.js";
import { DashboardSessionError } from "../auth/dashboard-session.js";
import { StoredAiProfileValidationError } from "../database/postgres-ai-profile-store.js";
import type { OwnedDiscordGuild } from "../discord/discord-oauth-service.js";

import {
  type ApiAnalyticsStore,
  type ApiServerDependencies,
  guildParametersSchema,
} from "./server-contracts.js";

const authenticatedRequests = new WeakSet<FastifyRequest>();

export async function authenticateRequest(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<AuthenticatedUser> {
  const sessionToken = request.cookies.summyz_session;
  if (sessionToken === undefined) throw new DashboardSessionError();
  const user = await dependencies.auth.authenticate(sessionToken);
  authenticatedRequests.add(request);
  return user;
}

export function wasRequestAuthenticated(request: FastifyRequest): boolean {
  return authenticatedRequests.has(request);
}

export async function authorizeGuild(
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

export type GuildAccessResolver = (userId: string) => Promise<readonly OwnedDiscordGuild[]>;

export function createGuildAccessResolver(
  dependencies: ApiServerDependencies,
): GuildAccessResolver {
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

export async function runApiDependency<T>(
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

export function logApiFailure(logger: Logger, request: FastifyRequest, error: unknown): void {
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

export async function requireOwner(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<AuthenticatedUser> {
  return authenticateRequest(request, dependencies);
}

export function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  const common = { httpOnly: true, path: "/", sameSite: "lax" as const, secure };
  reply.setCookie("summyz_session", token, { ...common, maxAge: 30 * 24 * 60 * 60 });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  const options = { httpOnly: true, path: "/", sameSite: "lax" as const, secure };
  reply.clearCookie("summyz_session", options);
}

export function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getErrorStatusCode(error: unknown): number {
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

export function requireAnalytics(dependencies: ApiServerDependencies): ApiAnalyticsStore {
  if (dependencies.analytics === undefined)
    throw new Error("Dashboard analytics are not configured");
  return dependencies.analytics;
}

export async function refreshParticipantProfiles(
  guildId: string,
  userIds: readonly string[],
  dependencies: ApiServerDependencies,
): Promise<ReadonlyMap<string, { avatarUrl?: string | null; displayName: string }>> {
  if (dependencies.guildDirectory.getMemberProfiles !== undefined && userIds.length > 0) {
    const profiles = await dependencies.guildDirectory
      .getMemberProfiles(guildId, userIds)
      .catch(() => new Map<string, { avatarUrl: string | null; displayName: string }>());
    await dependencies.analytics?.updateParticipantProfiles(guildId, profiles);
    return profiles;
  }
  if (dependencies.guildDirectory.getMemberDisplayNames === undefined || userIds.length === 0) {
    return new Map();
  }
  const names = await dependencies.guildDirectory
    .getMemberDisplayNames(guildId, userIds)
    .catch(() => new Map<string, string>());
  await dependencies.analytics?.updateDisplayNames(guildId, names);
  return new Map([...names].map(([userId, displayName]) => [userId, { displayName }]));
}
