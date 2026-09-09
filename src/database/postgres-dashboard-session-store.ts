import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type DashboardIdentity, dashboardIdentitySchema } from "../auth/dashboard-session.js";
import { dashboardLanguageSchema, dashboardThemeSchema } from "../auth/auth-domain.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const dateSchema = z.iso.datetime();
const rowSchema = z.object({
  dashboard_language: dashboardLanguageSchema,
  dashboard_theme: dashboardThemeSchema,
  discord_avatar: z.string().nullable(),
  discord_user_id: identifierSchema,
  discord_username: z.string().min(1).max(100),
});

export class PostgresDashboardSessionStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async createSession(input: {
    discordUserId: string;
    expiresAt: string;
    tokenHash: string;
  }): Promise<void> {
    await this.#database.query(
      `INSERT INTO dashboard_sessions (
         session_id, discord_user_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [
        randomUUID(),
        identifierSchema.parse(input.discordUserId),
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.expiresAt),
      ],
    );
  }

  public async findAndRefreshSession(input: {
    expiresAt: string;
    now: string;
    tokenHash: string;
  }): Promise<DashboardIdentity | undefined> {
    const result = await this.#database.query(
      `UPDATE dashboard_sessions AS session
       SET expires_at = $3, last_used_at = $2
       FROM installation_settings AS settings
       JOIN discord_connections AS connection
         ON connection.discord_user_id = settings.owner_discord_user_id
       WHERE session.token_hash = $1
         AND session.discord_user_id = settings.owner_discord_user_id
         AND session.revoked_at IS NULL
         AND session.expires_at > $2
       RETURNING session.discord_user_id,
                 connection.discord_username,
                 connection.discord_avatar,
                 settings.dashboard_language,
                 settings.dashboard_theme`,
      [
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.now),
        dateSchema.parse(input.expiresAt),
      ],
    );
    if (result.rows[0] === undefined) return undefined;
    const row = rowSchema.parse(result.rows[0]);
    return dashboardIdentitySchema.parse({
      dashboardLanguage: row.dashboard_language,
      dashboardTheme: row.dashboard_theme,
      discordAvatar: row.discord_avatar,
      discordUserId: row.discord_user_id,
      discordUsername: row.discord_username,
    });
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.#database.query(
      `UPDATE dashboard_sessions
       SET revoked_at = COALESCE(revoked_at, now())
       WHERE token_hash = $1`,
      [z.string().min(1).parse(tokenHash)],
    );
  }
}
