import { z } from "zod";

import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
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
  userId: string;
}

const connectionRowSchema = z.object({
  discord_avatar: z.string().nullable(),
  discord_user_id: z.string().min(1),
  discord_username: z.string().min(1),
  encrypted_oauth_credentials: z.string().min(1),
  user_id: z.string().uuid(),
});
const oauthStateRowSchema = z.object({
  encrypted_code_verifier: z.string().min(1),
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
    redirectUri: string;
    stateHash: string;
    userId: string;
  }): Promise<void> {
    await this.#database.query(
      `INSERT INTO discord_oauth_states (
         state_hash, user_id, encrypted_code_verifier, redirect_uri, expires_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [
        z.string().min(1).parse(input.stateHash),
        z.string().uuid().parse(input.userId),
        this.#secretBox.encrypt(z.string().min(1).parse(input.codeVerifier)),
        z.url().parse(input.redirectUri),
        z.iso.datetime().parse(input.expiresAt),
      ],
    );
  }

  public async consumeOAuthState(input: {
    now: string;
    stateHash: string;
    userId: string;
  }): Promise<{ codeVerifier: string; redirectUri: string } | undefined> {
    const result = await this.#database.query(
      `UPDATE discord_oauth_states
       SET consumed_at = $2
       WHERE state_hash = $1 AND user_id = $3 AND consumed_at IS NULL AND expires_at > $2
       RETURNING encrypted_code_verifier, redirect_uri`,
      [
        z.string().min(1).parse(input.stateHash),
        z.iso.datetime().parse(input.now),
        z.string().uuid().parse(input.userId),
      ],
    );
    if (result.rows[0] === undefined) return undefined;
    const row = oauthStateRowSchema.parse(result.rows[0]);
    return {
      codeVerifier: this.#secretBox.decrypt(row.encrypted_code_verifier),
      redirectUri: row.redirect_uri,
    };
  }

  public async saveConnection(input: DiscordConnection): Promise<void> {
    const credentials = discordOAuthCredentialsSchema.parse(input.credentials);
    await this.#database.query(
      `INSERT INTO discord_connections (
         user_id, discord_user_id, discord_username, discord_avatar,
         encrypted_oauth_credentials
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         discord_user_id = EXCLUDED.discord_user_id,
         discord_username = EXCLUDED.discord_username,
         discord_avatar = EXCLUDED.discord_avatar,
         encrypted_oauth_credentials = EXCLUDED.encrypted_oauth_credentials,
         updated_at = now()`,
      [
        z.string().uuid().parse(input.userId),
        identifierSchema.parse(input.discordUserId),
        z.string().min(1).max(100).parse(input.discordUsername),
        z.string().max(256).nullable().parse(input.discordAvatar),
        this.#secretBox.encrypt(JSON.stringify(credentials)),
      ],
    );
  }

  public async getConnection(userId: string): Promise<DiscordConnection | undefined> {
    const result = await this.#database.query(
      `SELECT user_id, discord_user_id, discord_username, discord_avatar,
              encrypted_oauth_credentials
       FROM discord_connections WHERE user_id = $1`,
      [z.string().uuid().parse(userId)],
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
      userId: row.user_id,
    };
  }

  public async deleteConnection(userId: string): Promise<void> {
    await this.#database.query("DELETE FROM discord_connections WHERE user_id = $1", [
      z.string().uuid().parse(userId),
    ]);
  }
}
