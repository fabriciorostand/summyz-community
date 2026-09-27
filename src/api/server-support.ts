import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { ZodError, type z } from "zod";
import type { DashboardAccess } from "../auth/auth-domain.js";
import { DashboardSessionError } from "../auth/dashboard-session.js";
import { InstallationAccessRecoveryError } from "../auth/installation-access-recovery.js";
import { InstallationLoginThrottleError } from "../auth/installation-login-throttle.js";
import { InstallationPasswordError } from "../auth/installation-password.js";
import {
  DuplicateProfileNameError,
  StoredAiProfileValidationError,
} from "../database/postgres-ai-profile-store.js";
import { ModelOperationError } from "../models/model-catalog.js";

import {
  type ApiAnalyticsStore,
  type ApiServerDependencies,
  guildParametersSchema,
  type InstalledDiscordGuild,
} from "./server-contracts.js";

const authenticatedRequests = new WeakSet<FastifyRequest>();

export async function authorizeDashboard(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<DashboardAccess> {
  if (dependencies.accessMode === "local") {
    const settings = await dependencies.settings.getSettings();
    return {
      dashboardLanguage: settings.dashboardLanguage,
      dashboardTheme: settings.dashboardTheme,
    };
  }
  const sessionToken = request.cookies.summyz_session;
  if (sessionToken === undefined || sessionToken.length === 0) throw new DashboardSessionError();
  const access = await dependencies.auth.authenticate(sessionToken);
  authenticatedRequests.add(request);
  return access;
}

export function wasRequestAuthenticated(request: FastifyRequest): boolean {
  return authenticatedRequests.has(request);
}

export async function authorizeGuild(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
  resolveGuildAccess: GuildAccessResolver,
): Promise<{ access: DashboardAccess; guildId: string }> {
  const access = await authorizeDashboard(request, dependencies);
  const { guildId } = parseRequestInput(guildParametersSchema, request.params);
  const guilds = await resolveGuildAccess();
  if (!guilds.some((guild) => guild.id === guildId)) {
    const error = new Error("guild_access_denied") as Error & { statusCode: number };
    error.statusCode = 403;
    throw error;
  }
  return { access, guildId };
}

export type GuildAccessResolver = () => Promise<readonly InstalledDiscordGuild[]>;

export function createGuildAccessResolver(
  dependencies: ApiServerDependencies,
): GuildAccessResolver {
  let cache: { expiresAt: number; request: Promise<readonly InstalledDiscordGuild[]> } | undefined;
  return async () => {
    const now = Date.now();
    if (cache !== undefined && cache.expiresAt > now) return cache.request;
    const request = runApiDependency("discord", "resolve_guild_access", () =>
      dependencies.guildDirectory.listInstalledGuilds(),
    );
    cache = { expiresAt: now + 10_000, request };
    try {
      return await request;
    } catch (error) {
      if (cache?.request === request) cache = undefined;
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

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie("summyz_session", token, {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
    sameSite: "strict",
    secure: true,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie("summyz_session", {
    httpOnly: true,
    path: "/",
    sameSite: "strict",
    secure: true,
  });
}

export function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getErrorStatusCode(error: unknown): number {
  if (error instanceof ZodError) return 500;
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

export class InvalidRequestError extends Error {
  public readonly issues: ZodError["issues"];

  public constructor(error: ZodError) {
    super("invalid_request");
    this.name = "InvalidRequestError";
    this.issues = error.issues;
  }
}

export function parseRequestInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw new InvalidRequestError(result.error);
  return result.data;
}

export function getKnownApiError(error: unknown):
  | {
      body: {
        error: string;
        issues?: unknown[];
        field?: string;
        message?: string;
        profileName?: string;
      };
      retryAfterSeconds?: number;
      statusCode: number;
    }
  | undefined {
  if (error instanceof DuplicateProfileNameError)
    return {
      statusCode: 409,
      body: {
        error: "profile_name_conflict",
        field: "name",
        profileName: error.profileName,
        message: `Já existe um perfil chamado '${error.profileName}'. Escolha outro nome.`,
      },
    };
  if (error instanceof ModelOperationError)
    return { statusCode: error.statusCode, body: { error: error.code } };
  if (error instanceof InvalidRequestError) {
    return { body: { error: "invalid_request", issues: error.issues }, statusCode: 400 };
  }
  if (error instanceof DashboardSessionError) {
    return { body: { error: "session_expired" }, statusCode: 401 };
  }
  if (error instanceof InstallationPasswordError) {
    return { body: { error: error.message }, statusCode: 401 };
  }
  if (error instanceof InstallationAccessRecoveryError) {
    return { body: { error: error.message }, statusCode: 403 };
  }
  if (error instanceof InstallationLoginThrottleError) {
    return {
      body: { error: error.message },
      retryAfterSeconds: error.retryAfterSeconds,
      statusCode: 429,
    };
  }
  return undefined;
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
