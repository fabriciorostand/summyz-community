import { z } from "zod";

import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
export const discordOAuthIntentSchema = z.enum(["setup", "login", "replace", "recovery"]);
export type DiscordOAuthIntent = z.infer<typeof discordOAuthIntentSchema>;
export const discordOAuthCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  refreshToken: z.string().min(1),
  scope: z.string().min(1),
});
export type DiscordOAuthCredentials = z.infer<typeof discordOAuthCredentialsSchema>;

export interface DiscordConnection {
  credentials: DiscordOAuthCredentials;
  discordAvatar: string | null;
  discordUserId: string;
  discordUsername: string;
}

const connectionRowSchema = z.object({
  discord_avatar: z.string().nullable(),
  discord_user_id: identifierSchema,
  discord_username: z.string().min(1),
  encrypted_oauth_credentials: z.string().min(1),
});
const oauthStateRowSchema = z.object({
  encrypted_code_verifier: z.string().min(1),
  initiator_discord_user_id: identifierSchema.nullable(),
  intent: discordOAuthIntentSchema,
  redirect_uri: z.url(),
});

interface StoreOptions {
  database: PostgresExecutor;
  secretBox: SecretBox;
}

export class PostgresDiscordConnectionStore {
  readonly #database: PostgresExecutor;
  readonly #secretBox: SecretBox;

  public constructor(options: StoreOptions) {
    this.#database = options.database;
    this.#secretBox = options.secretBox;
  }

  public async createOAuthState(input: {
    codeVerifier: string;
    expiresAt: string;
    initiatorDiscordUserId: string | null;
    intent: DiscordOAuthIntent;
    redirectUri: string;
    stateHash: string;
  }): Promise<void> {
    await this.#database.query(
      `INSERT INTO discord_oauth_states (
         state_hash, intent, initiator_discord_user_id, encrypted_code_verifier,
         redirect_uri, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        z.string().min(1).parse(input.stateHash),
        discordOAuthIntentSchema.parse(input.intent),
        identifierSchema.nullable().parse(input.initiatorDiscordUserId),
        this.#secretBox.encrypt(z.string().min(1).parse(input.codeVerifier)),
        z.url().parse(input.redirectUri),
        z.iso.datetime().parse(input.expiresAt),
      ],
    );
  }

  public async consumeOAuthState(input: { now: string; stateHash: string }): Promise<
    | {
        codeVerifier: string;
        initiatorDiscordUserId: string | null;
        intent: DiscordOAuthIntent;
        redirectUri: string;
      }
    | undefined
  > {
    const result = await this.#database.query(
      `UPDATE discord_oauth_states
       SET consumed_at = $2
       WHERE state_hash = $1 AND consumed_at IS NULL AND expires_at > $2
       RETURNING encrypted_code_verifier, redirect_uri, intent, initiator_discord_user_id`,
      [z.string().min(1).parse(input.stateHash), z.iso.datetime().parse(input.now)],
    );
    if (result.rows[0] === undefined) return undefined;
    const row = oauthStateRowSchema.parse(result.rows[0]);
    return {
      codeVerifier: this.#secretBox.decrypt(row.encrypted_code_verifier),
      initiatorDiscordUserId: row.initiator_discord_user_id,
      intent: row.intent,
      redirectUri: row.redirect_uri,
    };
  }

  public async replaceConnection(
    input: DiscordConnection,
    authorization: { allowAnyOwner: boolean; expectedOwnerDiscordUserId: string | null },
  ): Promise<boolean> {
    const credentials = discordOAuthCredentialsSchema.parse(input.credentials);
    const result = await this.#database.query(
      `WITH current_owner AS (
         SELECT owner_discord_user_id
         FROM installation_settings
         WHERE singleton = true
         FOR UPDATE
       ), authorized AS (
         SELECT 1 FROM current_owner
         WHERE $6::boolean
            OR owner_discord_user_id IS NOT DISTINCT FROM $5::text
       ), saved_connection AS (
         INSERT INTO discord_connections (
           singleton, discord_user_id, discord_username, discord_avatar,
           encrypted_oauth_credentials
         )
         SELECT true, $1, $2, $3, $4 FROM authorized
         ON CONFLICT (singleton) DO UPDATE SET
           discord_user_id = EXCLUDED.discord_user_id,
           discord_username = EXCLUDED.discord_username,
           discord_avatar = EXCLUDED.discord_avatar,
           encrypted_oauth_credentials = EXCLUDED.encrypted_oauth_credentials,
           updated_at = now()
         RETURNING discord_user_id
       ), updated_installation AS (
         UPDATE installation_settings
         SET owner_discord_user_id = saved_connection.discord_user_id,
             setup_completed_at = COALESCE(setup_completed_at, now()),
             updated_at = now()
         FROM saved_connection
         WHERE singleton = true
         RETURNING owner_discord_user_id
       ), revoked_sessions AS (
         UPDATE dashboard_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE discord_user_id <> $1
           AND EXISTS (SELECT 1 FROM updated_installation)
       )
       SELECT owner_discord_user_id FROM updated_installation`,
      [
        identifierSchema.parse(input.discordUserId),
        z.string().min(1).max(100).parse(input.discordUsername),
        z.string().max(256).nullable().parse(input.discordAvatar),
        this.#secretBox.encrypt(JSON.stringify(credentials)),
        identifierSchema.nullable().parse(authorization.expectedOwnerDiscordUserId),
        z.boolean().parse(authorization.allowAnyOwner),
      ],
    );
    return result.rows[0] !== undefined;
  }

  public async getConnection(): Promise<DiscordConnection | undefined> {
    const result = await this.#database.query(
      `SELECT discord_user_id, discord_username, discord_avatar, encrypted_oauth_credentials
       FROM discord_connections WHERE singleton = true`,
    );
    if (result.rows[0] === undefined) return undefined;
    const row = connectionRowSchema.parse(result.rows[0]);
    return {
      credentials: discordOAuthCredentialsSchema.parse(
        JSON.parse(this.#secretBox.decrypt(row.encrypted_oauth_credentials)),
      ),
      discordAvatar: row.discord_avatar,
      discordUserId: row.discord_user_id,
      discordUsername: row.discord_username,
    };
  }
}
