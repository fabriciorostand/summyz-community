import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { ZodError, type z } from "zod";
import { DashboardSessionError } from "../auth/dashboard-session.js";
import { InstallationAccessRecoveryError } from "../auth/installation-access-recovery.js";
import { InstallationLoginThrottleError } from "../auth/installation-login-throttle.js";
import { InstallationPasswordError } from "../auth/installation-password.js";
import {
  DuplicateProfileNameError,
  StoredAiProfileValidationError,
} from "../database/postgres-ai-profile-store.js";
import { DiscordRateLimitError } from "../discord/discord-api-fetch.js";
import { DiscordConnectionError } from "../discord/installation-discord-connection.js";
import { ModelOperationError } from "../models/model-catalog.js";

import {
  type ApiAnalyticsStore,
  type ApiServerDependencies,
  guildParametersSchema,
  type OwnedDiscordGuild,
} from "./server-contracts.js";

const authenticatedRequests = new WeakSet<FastifyRequest>();

class GuildAccessError extends Error {
  public constructor(
    public readonly code: string,
    public readonly statusCode: number,
    public readonly userMessage: string,
  ) {
    super(code);
    this.name = "GuildAccessError";
  }
}

export async function authorizeDashboard(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
): Promise<void> {
  if (dependencies.accessMode === "local") return;
  const sessionToken = request.cookies.summyz_session;
  if (sessionToken === undefined || sessionToken.length === 0) throw new DashboardSessionError();
  await dependencies.auth.authenticate(sessionToken);
  authenticatedRequests.add(request);
}

export function wasRequestAuthenticated(request: FastifyRequest): boolean {
  return authenticatedRequests.has(request);
}

export async function authorizeGuild(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
  resolveGuildAccess: GuildAccessResolver,
): Promise<{ guildId: string; ownerConfirmed: boolean }> {
  await authorizeDashboard(request, dependencies);
  const { guildId } = parseRequestInput(guildParametersSchema, request.params);
  const connectedBefore = await dependencies.discordConnection.getConnectedUserId();
  const guilds = await resolveGuildAccess();
  if (!guilds.some((guild) => guild.id === guildId && guild.installed)) {
    throw new GuildAccessError(
      "guild_access_denied",
      403,
      "Somente o dono do servidor vinculado a esta instalação pode ver ou configurar esse servidor com o bot instalado.",
    );
  }
  const connectedUserId = await dependencies.discordConnection.getConnectedUserId();
  if (connectedBefore !== connectedUserId) {
    throw new GuildAccessError(
      "discord_connection_changed",
      409,
      "A conta Discord vinculada mudou durante a solicitação. Entre novamente no dashboard e tente de novo.",
    );
  }
  if (connectedUserId === null) {
    throw new GuildAccessError(
      "discord_account_not_connected",
      403,
      "Conecte a conta Discord do dono do servidor antes de acessar ou configurar o bot.",
    );
  }
  const ownerConfirmed = await dependencies.guildOwnerApprovals.isConfirmed(
    guildId,
    connectedUserId,
  );
  return { guildId, ownerConfirmed };
}

export async function authorizeHistoricalGuild(
  request: FastifyRequest,
  dependencies: ApiServerDependencies,
  resolveGuildAccess: GuildAccessResolver,
): Promise<{ guildId: string }> {
  await authorizeDashboard(request, dependencies);
  const { guildId } = parseRequestInput(guildParametersSchema, request.params);
  if (await dependencies.guildHistory.hasMeetings(guildId)) return { guildId };
  return authorizeGuild(request, dependencies, resolveGuildAccess);
}

export type GuildAccessResolver = () => Promise<readonly OwnedDiscordGuild[]>;

export function createGuildAccessResolver(
  dependencies: ApiServerDependencies,
): GuildAccessResolver {
  return async () => {
    const connection = await dependencies.discordConnection.getConnectionStatus();
    if (!connection.connected) {
      throw new GuildAccessError(
        "discord_account_not_connected",
        403,
        "Conecte a conta Discord do dono do servidor antes de acessar ou configurar o bot.",
      );
    }
    const [owned, installed] = await Promise.all([
      runApiDependency("discord", "resolve_owned_guilds", () =>
        dependencies.discordConnection.listOwnedGuilds(),
      ),
      runApiDependency("discord", "resolve_installed_guilds", () =>
        dependencies.guildDirectory.listInstalledGuilds(),
      ),
    ]);
    const currentConnection = await dependencies.discordConnection.getConnectionStatus();
    if (
      !currentConnection.connected ||
      currentConnection.discordUserId !== connection.discordUserId
    ) {
      throw new GuildAccessError(
        "discord_connection_changed",
        409,
        "A conta Discord vinculada mudou durante a solicitação. Entre novamente no dashboard e tente de novo.",
      );
    }
    const installedIds = new Set(installed.map((guild) => guild.id));
    return owned.map((guild) => ({ ...guild, installed: installedIds.has(guild.id) }));
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

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Local mode has no password, so only loopback addresses may reach it. This blocks DNS
// rebinding, where a foreign domain resolves to 127.0.0.1 and keeps its own Host header.
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return false;
  const url = URL.parse(`http://${host}`);
  return (
    url !== null &&
    LOOPBACK_HOSTNAMES.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === ""
  );
}

export function isTrustedOrigin(
  origin: string | undefined,
  dependencies: Pick<ApiServerDependencies, "accessMode" | "publicBaseUrl">,
): boolean {
  if (origin === undefined) return false;
  if (dependencies.accessMode === "public") return origin === dependencies.publicBaseUrl;
  const url = URL.parse(origin);
  return (
    url !== null &&
    url.origin === origin &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTNAMES.has(url.hostname)
  );
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
  const cause = error instanceof ApiDependencyError ? error.cause : error;
  if (cause instanceof DiscordRateLimitError)
    return {
      statusCode: cause.statusCode,
      body: { error: cause.code },
      ...(cause.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: cause.retryAfterSeconds }),
    };
  if (cause instanceof DiscordConnectionError)
    return { statusCode: cause.statusCode, body: { error: cause.code } };
  if (error instanceof GuildAccessError)
    return {
      statusCode: error.statusCode,
      body: { error: error.code, message: error.userMessage },
    };
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
