import { randomUUID } from "node:crypto";

import { z } from "zod";
import type { PostgresExecutor } from "./postgres-database.js";

const dateSchema = z.iso.datetime();

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
  }): Promise<boolean> {
    const result = await this.#database.query(
      `UPDATE dashboard_sessions AS session
       SET expires_at = LEAST($3, session.absolute_expires_at), last_used_at = $2
       WHERE session.token_hash = $1
         AND session.revoked_at IS NULL
         AND session.expires_at > $2
         AND session.absolute_expires_at > $2
       RETURNING session.session_id`,
      [
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.now),
        dateSchema.parse(input.expiresAt),
      ],
    );
    return result.rowCount === 1;
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
