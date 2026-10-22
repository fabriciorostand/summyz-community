import { createHash, randomBytes } from "node:crypto";
import type { Logger } from "pino";
import { z } from "zod";
import { DiscordRateLimitError } from "./discord-api-fetch.js";
import { parseDiscordUserProfile } from "./discord-user-profile.js";

const PROFILE_CACHE_TTL_MS = 5 * 60_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().min(1),
  token_type: z.literal("Bearer"),
});
const userSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  global_name: z.string().nullable().optional(),
});
const guildsSchema = z.array(
  z.object({
    icon: z.string().nullable().optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    owner: z.boolean(),
  }),
);

export interface ConnectedDiscordAccount {
  accessToken: string;
  discordUserId: string;
  discordUsername: string;
  expiresAt: string;
  generation: number;
  refreshToken: string;
}

export interface ConnectedDiscordProfile {
  avatarUrl: string | null;
  discordUserId: string;
  discordUsername: string;
  generation: number;
  profileUpdatedAt: string | null;
}

export type DiscordConnectionProfile =
  | { connected: false }
  | { connected: true; avatarUrl: string | null; discordUserId: string; discordUsername: string };

export interface InstallationDiscordConnectionRepository {
  consumeState(input: {
    browserBindingHash: string;
    now: string;
    stateHash: string;
  }): Promise<boolean>;
  createState(input: {
    browserBindingHash: string;
    expiresAt: string;
    stateHash: string;
  }): Promise<void>;
  getConnection(): Promise<ConnectedDiscordAccount | undefined>;
  getProfile(): Promise<ConnectedDiscordProfile | undefined>;
  replaceConnection(connection: Omit<ConnectedDiscordAccount, "generation">): Promise<void>;
  updateProfile(input: {
    avatarUrl: string;
    discordUserId: string;
    discordUsername: string;
    expectedGeneration: number;
    profileUpdatedAt: string;
  }): Promise<boolean>;
  updateTokens(input: {
    accessToken: string;
    expiresAt: string;
    expectedGeneration: number;
    refreshToken: string;
  }): Promise<boolean>;
}

export class DiscordConnectionError extends Error {
  public constructor(
    public readonly code: string,
    public readonly statusCode = 403,
  ) {
    super(code);
    this.name = "DiscordConnectionError";
  }
}

interface InstallationDiscordConnectionOptions {
  applicationId(): Promise<string | null>;
  clientSecret(): Promise<string | undefined>;
  fetch: typeof globalThis.fetch;
  logger?: Pick<Logger, "warn">;
  now?: () => Date;
  publicBaseUrl: string;
  randomToken?: () => string;
  repository: InstallationDiscordConnectionRepository;
}

export class InstallationDiscordConnection {
  readonly #applicationId: InstallationDiscordConnectionOptions["applicationId"];
  readonly #clientSecret: InstallationDiscordConnectionOptions["clientSecret"];
  readonly #fetch: typeof globalThis.fetch;
  readonly #logger: Pick<Logger, "warn"> | undefined;
  readonly #now: () => Date;
  readonly #publicBaseUrl: string;
  readonly #randomToken: () => string;
  readonly #repository: InstallationDiscordConnectionRepository;
  #ownedGuildLookup:
    | {
        key: string;
        request: Promise<{ iconUrl: string | null; id: string; name: string }[]>;
      }
    | undefined;
  #tokenRefresh: { key: string; request: Promise<ConnectedDiscordAccount> } | undefined;
  #profileRefresh: { key: string; request: Promise<void> } | undefined;

  public constructor(options: InstallationDiscordConnectionOptions) {
    this.#applicationId = options.applicationId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetch;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#publicBaseUrl = options.publicBaseUrl;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#repository = options.repository;
  }

  public async createAuthorizationUrl(browserBinding: string): Promise<string> {
    const clientId = await this.#requireApplicationId();
    await this.#requireClientSecret();
    const state = z.string().min(1).parse(this.#randomToken());
    await this.#repository.createState({
      browserBindingHash: hash(browserBinding),
      expiresAt: new Date(this.#now().getTime() + 10 * 60_000).toISOString(),
      stateHash: hash(state),
    });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.#redirectUri(),
      response_type: "code",
      scope: "identify guilds",
      state,
    }).toString();
    return url.toString();
  }

  public async completeAuthorization(
    browserBinding: string,
    code: string,
    state: string,
  ): Promise<void> {
    await this.#consumeState(browserBinding, state);
    const clientId = await this.#requireApplicationId();
    const clientSecret = await this.#requireClientSecret();
    const token = await this.#exchangeToken(
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: z.string().min(1).max(2048).parse(code),
        grant_type: "authorization_code",
        redirect_uri: this.#redirectUri(),
      }),
    );
    const response = await this.#fetch("https://discord.com/api/v10/users/@me", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new DiscordConnectionError("discord_identity_unavailable", 502);
    const user = userSchema.parse(await response.json());
    await this.#repository.replaceConnection({
      accessToken: token.access_token,
      discordUserId: user.id,
      discordUsername: user.global_name ?? user.username,
      expiresAt: new Date(this.#now().getTime() + token.expires_in * 1000).toISOString(),
      refreshToken: token.refresh_token,
    });
  }

  public async cancelAuthorization(browserBinding: string, state: string): Promise<void> {
    await this.#consumeState(browserBinding, state);
  }

  async #consumeState(browserBinding: string, state: string): Promise<void> {
    const consumed = await this.#repository.consumeState({
      browserBindingHash: hash(browserBinding),
      now: this.#now().toISOString(),
      stateHash: hash(state),
    });
    if (!consumed) throw new DiscordConnectionError("invalid_oauth_state");
  }

  public async getConnectionStatus(): Promise<
    { connected: false } | { connected: true; discordUserId: string; discordUsername: string }
  > {
    const connection = await this.#repository.getConnection();
    if (connection === undefined) return { connected: false };
    return {
      connected: true,
      discordUserId: connection.discordUserId,
      discordUsername: connection.discordUsername,
    };
  }

  public async getConnectedUserId(): Promise<string | null> {
    return (await this.#repository.getConnection())?.discordUserId ?? null;
  }

  public async getConnectionProfile(): Promise<DiscordConnectionProfile> {
    const profile = await this.#repository.getProfile();
    if (profile === undefined) return { connected: false };
    if (
      profile.profileUpdatedAt === null ||
      Date.parse(profile.profileUpdatedAt) + PROFILE_CACHE_TTL_MS <= this.#now().getTime()
    ) {
      const key = `${profile.discordUserId}:${profile.generation}`;
      const request =
        this.#profileRefresh?.key === key
          ? this.#profileRefresh.request
          : this.#refreshProfile(profile);
      this.#profileRefresh = { key, request };
      try {
        await request;
      } finally {
        if (this.#profileRefresh?.request === request) this.#profileRefresh = undefined;
      }
      // Re-read after the guarded write or a failed lookup: the account may have changed.
      return connectionProfileOf(await this.#repository.getProfile());
    }
    return connectionProfileOf(profile);
  }

  async #refreshProfile(profile: ConnectedDiscordProfile): Promise<void> {
    let connection: ConnectedDiscordAccount;
    let current: ReturnType<typeof parseDiscordUserProfile>;
    try {
      connection = await this.#getCurrentConnection();
      if (connection.discordUserId !== profile.discordUserId) return;
      const response = await this.#fetch("https://discord.com/api/v10/users/@me", {
        headers: { authorization: `Bearer ${connection.accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new DiscordConnectionError("discord_identity_unavailable", 502);
      }
      current = parseDiscordUserProfile(await response.json());
      if (current.discordUserId !== connection.discordUserId) {
        throw new DiscordConnectionError("discord_identity_mismatch", 502);
      }
    } catch (error) {
      // External error messages and payloads can contain credentials; log only known codes.
      const code =
        error instanceof DiscordConnectionError || error instanceof DiscordRateLimitError
          ? error.code
          : "discord_profile_unavailable";
      this.#logger?.warn(
        { code, event: "discord_profile_refresh_failed" },
        "Discord profile refresh failed",
      );
      return;
    }
    await this.#repository.updateProfile({
      ...current,
      expectedGeneration: connection.generation,
      profileUpdatedAt: this.#now().toISOString(),
    });
  }

  public async listOwnedGuilds(): Promise<{ iconUrl: string | null; id: string; name: string }[]> {
    const connection = await this.#getCurrentConnection();
    const key = `${connection.discordUserId}:${connection.generation}`;
    if (this.#ownedGuildLookup?.key === key) return this.#ownedGuildLookup.request;
    const request = this.#fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { authorization: `Bearer ${connection.accessToken}` },
    }).then(async (response) => {
      if (!response.ok) throw new DiscordConnectionError("discord_guilds_unavailable", 502);
      const guilds = guildsSchema.parse(await response.json());
      return guilds
        .filter((guild) => guild.owner)
        .map((guild) => ({
          iconUrl:
            guild.icon === undefined || guild.icon === null
              ? null
              : `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`,
          id: guild.id,
          name: guild.name,
        }));
    });
    this.#ownedGuildLookup = { key, request };
    try {
      return await request;
    } finally {
      if (this.#ownedGuildLookup?.request === request) this.#ownedGuildLookup = undefined;
    }
  }

  async #getCurrentConnection(): Promise<ConnectedDiscordAccount> {
    const connection = await this.#repository.getConnection();
    if (connection === undefined) throw new DiscordConnectionError("discord_account_not_connected");
    if (Date.parse(connection.expiresAt) > this.#now().getTime() + 60_000) return connection;
    const key = `${connection.discordUserId}:${connection.generation}`;
    if (this.#tokenRefresh?.key === key) return this.#tokenRefresh.request;
    const request = this.#refreshConnection(connection);
    this.#tokenRefresh = { key, request };
    try {
      return await request;
    } finally {
      if (this.#tokenRefresh?.request === request) this.#tokenRefresh = undefined;
    }
  }

  async #refreshConnection(connection: ConnectedDiscordAccount): Promise<ConnectedDiscordAccount> {
    const token = await this.#exchangeToken(
      new URLSearchParams({
        client_id: await this.#requireApplicationId(),
        client_secret: await this.#requireClientSecret(),
        grant_type: "refresh_token",
        refresh_token: connection.refreshToken,
      }),
    );
    const expiresAt = new Date(this.#now().getTime() + token.expires_in * 1000).toISOString();
    const changed = await this.#repository.updateTokens({
      accessToken: token.access_token,
      expectedGeneration: connection.generation,
      expiresAt,
      refreshToken: token.refresh_token,
    });
    if (!changed) throw new DiscordConnectionError("discord_connection_changed", 409);
    return {
      ...connection,
      accessToken: token.access_token,
      expiresAt,
      generation: connection.generation + 1,
      refreshToken: token.refresh_token,
    };
  }

  async #exchangeToken(parameters: URLSearchParams) {
    const response = await this.#fetch("https://discord.com/api/v10/oauth2/token", {
      body: parameters,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) throw new DiscordConnectionError("discord_oauth_unavailable", 502);
    const token = tokenResponseSchema.parse(await response.json());
    const scopes = new Set(token.scope.split(" "));
    if (!scopes.has("identify") || !scopes.has("guilds")) {
      throw new DiscordConnectionError("discord_oauth_scope_missing");
    }
    return token;
  }

  async #requireApplicationId(): Promise<string> {
    const value = await this.#applicationId();
    if (value === null) throw new DiscordConnectionError("discord_bot_not_configured", 409);
    return z.string().min(1).parse(value);
  }

  async #requireClientSecret(): Promise<string> {
    const value = await this.#clientSecret();
    if (value === undefined) throw new DiscordConnectionError("discord_client_secret_missing", 409);
    return z.string().min(1).parse(value);
  }

  #redirectUri(): string {
    return createDiscordOAuthRedirectUri(this.#publicBaseUrl);
  }
}

export function createDiscordOAuthRedirectUri(publicBaseUrl: string): string {
  return new URL("/api/discord/callback", publicBaseUrl).toString();
}

function hash(value: string): string {
  return createHash("sha256").update(z.string().min(1).parse(value), "utf8").digest("base64url");
}

function connectionProfileOf(
  profile: ConnectedDiscordProfile | undefined,
): DiscordConnectionProfile {
  if (profile === undefined) return { connected: false };
  return {
    avatarUrl: profile.avatarUrl,
    connected: true,
    discordUserId: profile.discordUserId,
    discordUsername: profile.discordUsername,
  };
}
