import { randomUUID } from "node:crypto";

import { z } from "zod";
import { dashboardLanguageSchema, dashboardThemeSchema } from "../auth/auth-domain.js";
import { dashboardAccessSchema, type StoredDashboardAccess } from "../auth/dashboard-session.js";
import type { PostgresExecutor } from "./postgres-database.js";

const dateSchema = z.iso.datetime();
const rowSchema = z.object({
  dashboard_language: dashboardLanguageSchema,
  dashboard_theme: dashboardThemeSchema,
});

export class PostgresDashboardSessionStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async createSession(input: {
    absoluteExpiresAt: string;
    expiresAt: string;
    tokenHash: string;
  }): Promise<void> {
    await this.#database.query(
      `INSERT INTO dashboard_sessions (
         session_id, token_hash, expires_at, absolute_expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [
        randomUUID(),
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.expiresAt),
        dateSchema.parse(input.absoluteExpiresAt),
      ],
    );
  }

  public async findAndRefreshSession(input: {
    expiresAt: string;
    now: string;
    tokenHash: string;
  }): Promise<StoredDashboardAccess | undefined> {
    const result = await this.#database.query(
      `UPDATE dashboard_sessions AS session
       SET expires_at = LEAST($3, session.absolute_expires_at), last_used_at = $2
       FROM installation_settings AS settings
       WHERE session.token_hash = $1
         AND session.revoked_at IS NULL
         AND session.expires_at > $2
         AND session.absolute_expires_at > $2
       RETURNING settings.dashboard_language,
                 settings.dashboard_theme`,
      [
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.now),
        dateSchema.parse(input.expiresAt),
      ],
    );
    if (result.rows[0] === undefined) return undefined;
    const row = rowSchema.parse(result.rows[0]);
    return dashboardAccessSchema.parse({
      dashboardLanguage: row.dashboard_language,
      dashboardTheme: row.dashboard_theme,
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
