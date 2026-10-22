import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { PostgresExecutor } from "./postgres-database.js";

const hashSchema = z.string().min(1).max(1_024);
const dateSchema = z.iso.datetime();

export class PostgresInstallationAccessStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async getPasswordHash(): Promise<string | undefined> {
    const result = await this.#database.query(
      "SELECT password_hash FROM installation_access WHERE singleton = true",
    );
    const value = result.rows[0]?.password_hash;
    return value === undefined ? undefined : hashSchema.parse(value);
  }

  public async initialize(passwordHash: string): Promise<boolean> {
    const result = await this.#database.query(
      `INSERT INTO installation_access (singleton, password_hash)
       VALUES (true, $1)
       ON CONFLICT (singleton) DO NOTHING
       RETURNING singleton`,
      [hashSchema.parse(passwordHash)],
    );
    return result.rows[0] !== undefined;
  }

  public async replace(expectedPasswordHash: string, passwordHash: string): Promise<boolean> {
    const result = await this.#database.query(
      `WITH updated_access AS (
         UPDATE installation_access
         SET password_hash = $2, updated_at = now()
         WHERE singleton = true AND password_hash = $1
         RETURNING singleton
       ), revoked_sessions AS (
         UPDATE dashboard_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE EXISTS (SELECT 1 FROM updated_access)
       )
       SELECT singleton FROM updated_access`,
      [hashSchema.parse(expectedPasswordHash), hashSchema.parse(passwordHash)],
    );
    return result.rows[0] !== undefined;
  }

  public async createRecoveryToken(input: { expiresAt: string; tokenHash: string }): Promise<void> {
    await this.#database.query(
      `WITH revoked_tokens AS (
         UPDATE installation_recovery_tokens
         SET consumed_at = COALESCE(consumed_at, now())
         WHERE consumed_at IS NULL
       )
       INSERT INTO installation_recovery_tokens (recovery_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [randomUUID(), hashSchema.parse(input.tokenHash), dateSchema.parse(input.expiresAt)],
    );
  }

  public async consumeRecoveryToken(input: {
    now: string;
    passwordHash: string;
    tokenHash: string;
  }): Promise<boolean> {
    const result = await this.#database.query(
      `WITH consumed_token AS (
         UPDATE installation_recovery_tokens
         SET consumed_at = $2
         WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > $2
         RETURNING recovery_id
       ), updated_access AS (
         UPDATE installation_access
         SET password_hash = $3, updated_at = now()
         WHERE singleton = true AND EXISTS (SELECT 1 FROM consumed_token)
         RETURNING singleton
       ), revoked_sessions AS (
         UPDATE dashboard_sessions
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE EXISTS (SELECT 1 FROM updated_access)
       )
       SELECT singleton FROM updated_access`,
      [
        hashSchema.parse(input.tokenHash),
        dateSchema.parse(input.now),
        hashSchema.parse(input.passwordHash),
      ],
    );
    return result.rows[0] !== undefined;
  }
}
