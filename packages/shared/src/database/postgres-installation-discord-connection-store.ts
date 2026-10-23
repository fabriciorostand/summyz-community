import { z } from "zod";
import type {
  ConnectedDiscordAccount,
  ConnectedDiscordProfile,
  InstallationDiscordConnectionRepository,
} from "../discord/installation-discord-connection.js";
import type { SecretBox } from "../security/secret-box.js";
import type { PostgresExecutor } from "./postgres-database.js";

const connectionRowSchema = z.object({
  discord_user_id: z.string().min(1),
  discord_username: z.string().min(1),
  encrypted_access_token: z.string().min(1),
  encrypted_refresh_token: z.string().min(1),
  generation: z.coerce.number().int().positive(),
  token_expires_at: z.union([z.date(), z.iso.datetime()]),
});
const dateSchema = z.iso.datetime();
const hashSchema = z.string().min(1).max(128);
const avatarUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.hostname === "cdn.discordapp.com" &&
    url.username === "" &&
    url.password === "" &&
    url.port === ""
  );
});
const profileRowSchema = z.object({
  avatar_url: avatarUrlSchema.nullable(),
  discord_user_id: z.string().min(1),
  discord_username: z.string().min(1),
  generation: z.coerce.number().int().positive(),
  profile_updated_at: z.union([z.date(), dateSchema]).nullable(),
});

export class PostgresInstallationDiscordConnectionStore
  implements InstallationDiscordConnectionRepository
{
  readonly #database: PostgresExecutor;
  readonly #secretBox: SecretBox;

  public constructor(database: PostgresExecutor, secretBox: SecretBox) {
    this.#database = database;
    this.#secretBox = secretBox;
  }

  public async createState(input: {
    browserBindingHash: string;
    expiresAt: string;
    stateHash: string;
  }): Promise<void> {
    await this.#database.query("DELETE FROM installation_oauth_states WHERE expires_at <= now()");
    await this.#database.query(
      `INSERT INTO installation_oauth_states (state_hash, browser_binding_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [
        hashSchema.parse(input.stateHash),
        hashSchema.parse(input.browserBindingHash),
        dateSchema.parse(input.expiresAt),
      ],
    );
  }

  public async consumeState(input: {
    browserBindingHash: string;
    now: string;
    stateHash: string;
  }): Promise<boolean> {
    const result = await this.#database.query(
      `DELETE FROM installation_oauth_states
       WHERE state_hash = $1 AND browser_binding_hash = $2 AND expires_at > $3
       RETURNING state_hash`,
      [
        hashSchema.parse(input.stateHash),
        hashSchema.parse(input.browserBindingHash),
        dateSchema.parse(input.now),
      ],
    );
    return result.rowCount === 1;
  }

  public async getConnection(): Promise<ConnectedDiscordAccount | undefined> {
    const result = await this.#database.query(
      `SELECT discord_user_id, discord_username, encrypted_access_token,
              encrypted_refresh_token, token_expires_at, generation
       FROM installation_discord_connection WHERE singleton = true`,
    );
    const first = result.rows[0];
    if (first === undefined) return undefined;
    const row = connectionRowSchema.parse(first);
    return {
      accessToken: this.#secretBox.decrypt(row.encrypted_access_token),
      discordUserId: row.discord_user_id,
      discordUsername: row.discord_username,
      expiresAt:
        row.token_expires_at instanceof Date
          ? row.token_expires_at.toISOString()
          : row.token_expires_at,
      generation: row.generation,
      refreshToken: this.#secretBox.decrypt(row.encrypted_refresh_token),
    };
  }

  public async replaceConnection(
    connection: Omit<ConnectedDiscordAccount, "generation">,
  ): Promise<void> {
    if (this.#database.transaction === undefined) {
      throw new Error("A database transaction is required to replace the Discord account");
    }
    const access = this.#secretBox.encrypt(z.string().min(1).parse(connection.accessToken));
    const refresh = this.#secretBox.encrypt(z.string().min(1).parse(connection.refreshToken));
    await this.#database.transaction(async (database) => {
      await database.query(
        `INSERT INTO installation_discord_connection (
           singleton, discord_user_id, discord_username, encrypted_access_token,
           encrypted_refresh_token, token_expires_at
         ) VALUES (true, $1, $2, $3, $4, $5)
         ON CONFLICT (singleton) DO UPDATE SET
           discord_user_id = EXCLUDED.discord_user_id,
           discord_username = EXCLUDED.discord_username,
           avatar_url = NULL,
           profile_updated_at = NULL,
           encrypted_access_token = EXCLUDED.encrypted_access_token,
           encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           generation = installation_discord_connection.generation + 1,
           updated_at = now()`,
        [
          z.string().min(1).parse(connection.discordUserId),
          z.string().min(1).parse(connection.discordUsername),
          access,
          refresh,
          dateSchema.parse(connection.expiresAt),
        ],
      );
      await database.query(
        "UPDATE dashboard_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE revoked_at IS NULL",
      );
      await database.query("DELETE FROM installation_oauth_states");
    });
  }

  public async updateTokens(input: {
    accessToken: string;
    expectedGeneration: number;
    expiresAt: string;
    refreshToken: string;
  }): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE installation_discord_connection
       SET encrypted_access_token = $1, encrypted_refresh_token = $2,
           token_expires_at = $3, generation = generation + 1, updated_at = now()
       WHERE singleton = true AND generation = $4
       RETURNING singleton`,
      [
        this.#secretBox.encrypt(z.string().min(1).parse(input.accessToken)),
        this.#secretBox.encrypt(z.string().min(1).parse(input.refreshToken)),
        dateSchema.parse(input.expiresAt),
        z.number().int().positive().parse(input.expectedGeneration),
      ],
    );
    return result.rowCount === 1;
  }

  public async getProfile(): Promise<ConnectedDiscordProfile | undefined> {
    const result = await this.#database.query(
      `SELECT discord_user_id, discord_username, avatar_url, profile_updated_at, generation
       FROM installation_discord_connection WHERE singleton = true`,
    );
    const first = result.rows[0];
    if (first === undefined) return undefined;
    const row = profileRowSchema.parse(first);
    return {
      avatarUrl: row.avatar_url,
      discordUserId: row.discord_user_id,
      discordUsername: row.discord_username,
      generation: row.generation,
      profileUpdatedAt:
        row.profile_updated_at instanceof Date
          ? row.profile_updated_at.toISOString()
          : row.profile_updated_at,
    };
  }

  public async updateProfile(input: {
    avatarUrl: string;
    discordUserId: string;
    discordUsername: string;
    expectedGeneration: number;
    profileUpdatedAt: string;
  }): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE installation_discord_connection
       SET discord_username = $1, avatar_url = $2, profile_updated_at = $3, updated_at = now()
       WHERE singleton = true AND discord_user_id = $4 AND generation = $5
       RETURNING singleton`,
      [
        z.string().min(1).parse(input.discordUsername),
        avatarUrlSchema.parse(input.avatarUrl),
        dateSchema.parse(input.profileUpdatedAt),
        z.string().min(1).parse(input.discordUserId),
        z.number().int().positive().parse(input.expectedGeneration),
      ],
    );
    return result.rowCount === 1;
  }
}
