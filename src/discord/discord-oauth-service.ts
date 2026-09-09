import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type {
  DiscordConnection,
  DiscordOAuthCredentials,
  DiscordOAuthIntent,
} from "../database/postgres-discord-connection-store.js";

const discordGuildSchema = z.object({
  icon: z.string().nullable(),
  id: z.string().min(1),
  name: z.string().min(1),
  owner: z.boolean(),
});
const discordGuildsSchema = z.array(discordGuildSchema);
const discordUserSchema = z.object({
  avatar: z.string().nullable(),
  global_name: z.string().nullable().optional(),
  id: z.string().min(1).max(128),
  username: z.string().min(1),
});
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
  scope: z.string().min(1),
  token_type: z.literal("Bearer"),
});

interface DiscordConnectionRepository {
  consumeOAuthState(input: { now: string; stateHash: string }): Promise<
    | {
        codeVerifier: string;
        initiatorDiscordUserId: string | null;
        intent: DiscordOAuthIntent;
        redirectUri: string;
      }
    | undefined
  >;
  createOAuthState(input: {
    codeVerifier: string;
    expiresAt: string;
    initiatorDiscordUserId: string | null;
    intent: DiscordOAuthIntent;
    redirectUri: string;
    stateHash: string;
  }): Promise<void>;
  getConnection(): Promise<DiscordConnection | undefined>;
  replaceConnection(
    connection: DiscordConnection,
    authorization: {
      allowAnyOwner: boolean;
      expectedOwnerDiscordUserId: string | null;
    },
  ): Promise<boolean>;
}

interface DiscordOAuthSettings {
  getDiscordOAuthConfiguration(): Promise<{
    clientId: string;
    clientSecret: string;
    publicBaseUrl: string;
  }>;
}

interface DiscordOAuthServiceOptions {
  fetch: typeof globalThis.fetch;
  now?: () => Date;
  randomToken?: () => string;
  repository: DiscordConnectionRepository;
  settings: DiscordOAuthSettings;
}

export interface OwnedDiscordGuild {
  iconUrl: string | null;
  id: string;
  installUrl: string;
  installed: boolean;
  name: string;
}

export type DiscordConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      discordAvatar: string | null;
      discordUserId: string;
      discordUsername: string;
    };

export class DiscordOAuthError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DiscordOAuthError";
  }
}

const MINUTE_MS = 60_000;

export class DiscordOAuthService {
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => Date;
  readonly #randomToken: () => string;
  readonly #repository: DiscordConnectionRepository;
  readonly #settings: DiscordOAuthSettings;

  public constructor(options: DiscordOAuthServiceOptions) {
    this.#fetch = options.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#repository = options.repository;
    this.#settings = options.settings;
  }

  public async createAuthorizationUrl(input: {
    initiatorDiscordUserId?: string;
    intent: DiscordOAuthIntent;
  }): Promise<string> {
    if (input.intent === "replace" && input.initiatorDiscordUserId === undefined) {
      throw new DiscordOAuthError("Owner replacement requires an authenticated owner");
    }
    const configuration = await this.#settings.getDiscordOAuthConfiguration();
    const state = this.#randomToken();
    const codeVerifier = this.#randomToken();
    const redirectUri = new URL("/api/discord/callback", configuration.publicBaseUrl).toString();
    await this.#repository.createOAuthState({
      codeVerifier,
      expiresAt: new Date(this.#now().getTime() + 10 * MINUTE_MS).toISOString(),
      initiatorDiscordUserId: input.initiatorDiscordUserId ?? null,
      intent: input.intent,
      redirectUri,
      stateHash: hashToken(state),
    });
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: configuration.clientId,
      code_challenge: hashToken(codeVerifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state,
    }).toString();
    return url.toString();
  }

  public async completeAuthorization(code: string, state: string): Promise<DiscordConnection> {
    const oauthState = await this.#repository.consumeOAuthState({
      now: this.#now().toISOString(),
      stateHash: hashToken(state),
    });
    if (oauthState === undefined) throw new DiscordOAuthError("Invalid or expired OAuth state");
    const configuration = await this.#settings.getDiscordOAuthConfiguration();
    const credentials = await this.#exchangeToken(
      new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        code,
        code_verifier: oauthState.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: oauthState.redirectUri,
      }),
    );
    const payload = await this.#discordRequest(
      "https://discord.com/api/v10/users/@me",
      credentials,
    );
    const user = discordUserSchema.parse(payload);
    const connection = {
      credentials,
      discordAvatar: user.avatar,
      discordUserId: user.id,
      discordUsername: user.global_name ?? user.username,
    };
    const authorization = authorizationFor(oauthState, user.id);
    if (!(await this.#repository.replaceConnection(connection, authorization))) {
      throw new DiscordOAuthError("Discord account is not the installation owner");
    }
    return connection;
  }

  public async getConnectionStatus(userId: string): Promise<DiscordConnectionStatus> {
    const connection = await this.#repository.getConnection();
    if (connection === undefined || connection.discordUserId !== userId)
      return { connected: false };
    return {
      connected: true,
      discordAvatar: connection.discordAvatar,
      discordUserId: connection.discordUserId,
      discordUsername: connection.discordUsername,
    };
  }

  public async listOwnedGuilds(
    userId: string,
    installedGuildIds: ReadonlySet<string>,
  ): Promise<OwnedDiscordGuild[]> {
    const connection = await this.#requireConnection(userId);
    const credentials = await this.#refreshIfNeeded(connection);
    const payload = await this.#discordRequest(
      "https://discord.com/api/v10/users/@me/guilds",
      credentials,
    );
    const guilds = discordGuildsSchema.parse(payload);
    const configuration = await this.#settings.getDiscordOAuthConfiguration();
    return guilds
      .filter((guild) => guild.owner)
      .map((guild) => ({
        iconUrl:
          guild.icon === null
            ? null
            : `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`,
        id: guild.id,
        installUrl: createInstallUrl(configuration.clientId, guild.id),
        installed: installedGuildIds.has(guild.id),
        name: guild.name,
      }));
  }

  async #discordRequest(url: string, credentials: DiscordOAuthCredentials): Promise<unknown> {
    const response = await this.#fetch(url, {
      headers: { authorization: `Bearer ${credentials.accessToken}` },
    });
    if (!response.ok) throw new DiscordOAuthError("Discord API request failed");
    const payload: unknown = await response.json();
    return payload;
  }

  async #exchangeToken(body: URLSearchParams): Promise<DiscordOAuthCredentials> {
    const response = await this.#fetch("https://discord.com/api/v10/oauth2/token", {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    if (!response.ok) throw new DiscordOAuthError("Discord token exchange failed");
    const payload: unknown = await response.json();
    const token = tokenResponseSchema.parse(payload);
    return {
      accessToken: token.access_token,
      expiresAt: new Date(this.#now().getTime() + token.expires_in * 1_000).toISOString(),
      refreshToken: token.refresh_token,
      scope: token.scope,
    };
  }

  async #refreshIfNeeded(connection: DiscordConnection): Promise<DiscordOAuthCredentials> {
    if (new Date(connection.credentials.expiresAt).getTime() > this.#now().getTime() + MINUTE_MS) {
      return connection.credentials;
    }
    const configuration = await this.#settings.getDiscordOAuthConfiguration();
    const credentials = await this.#exchangeToken(
      new URLSearchParams({
        client_id: configuration.clientId,
        client_secret: configuration.clientSecret,
        grant_type: "refresh_token",
        refresh_token: connection.credentials.refreshToken,
      }),
    );
    const refreshed = { ...connection, credentials };
    const saved = await this.#repository.replaceConnection(refreshed, {
      allowAnyOwner: false,
      expectedOwnerDiscordUserId: connection.discordUserId,
    });
    if (!saved) throw new DiscordOAuthError("Discord account is not connected");
    return credentials;
  }

  async #requireConnection(userId: string): Promise<DiscordConnection> {
    const connection = await this.#repository.getConnection();
    if (connection === undefined || connection.discordUserId !== userId) {
      throw new DiscordOAuthError("Discord account is not connected");
    }
    return connection;
  }
}

function authorizationFor(
  state: { initiatorDiscordUserId: string | null; intent: DiscordOAuthIntent },
  authenticatedDiscordUserId: string,
): { allowAnyOwner: boolean; expectedOwnerDiscordUserId: string | null } {
  if (state.intent === "setup") {
    return { allowAnyOwner: false, expectedOwnerDiscordUserId: null };
  }
  if (state.intent === "login") {
    return { allowAnyOwner: false, expectedOwnerDiscordUserId: authenticatedDiscordUserId };
  }
  if (state.intent === "recovery") {
    return { allowAnyOwner: true, expectedOwnerDiscordUserId: null };
  }
  return { allowAnyOwner: false, expectedOwnerDiscordUserId: state.initiatorDiscordUserId };
}

function createInstallUrl(clientId: string, guildId: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    disable_guild_select: "true",
    guild_id: guildId,
    permissions: "326417521664",
    scope: "bot applications.commands",
  }).toString();
  return url.toString();
}

function hashToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}
