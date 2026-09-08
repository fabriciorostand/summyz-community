import { z } from "zod";
import {
  dashboardLanguageSchema,
  dashboardThemeSchema,
  installationRoleSchema,
} from "../auth/auth-domain.js";
import type {
  AuthRepository,
  AuthTokenPurpose,
  StoredDashboardUser,
  StoredSession,
} from "../auth/auth-service.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const dateSchema = z.iso.datetime();
const userRowSchema = z.object({
  dashboard_language: dashboardLanguageSchema,
  dashboard_theme: dashboardThemeSchema,
  email: z.string().email(),
  email_verified_at: z.union([z.string(), z.date()]).nullable(),
  installation_role: installationRoleSchema,
  password_hash: z.string().min(1),
  user_id: identifierSchema,
});
const sessionRowSchema = z.object({
  session_id: identifierSchema,
  user_id: identifierSchema,
});
const tokenPurposeSchema = z.enum(["email_verification", "password_reset"]);

export class PostgresAuthRepository implements AuthRepository {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async createUser(input: {
    dashboardLanguage: "en" | "pt-BR";
    email: string;
    emailVerified: boolean;
    installationRole: "administrator" | "member";
    passwordHash: string;
    userId: string;
  }): Promise<StoredDashboardUser> {
    const result = await this.#database.query(
      `INSERT INTO dashboard_users (
         user_id, email, password_hash, dashboard_language, installation_role, email_verified_at
       ) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() ELSE NULL END)
       RETURNING user_id, email, password_hash, dashboard_language, dashboard_theme,
                 installation_role, email_verified_at`,
      [
        identifierSchema.parse(input.userId),
        z.string().email().parse(input.email),
        z.string().min(1).parse(input.passwordHash),
        dashboardLanguageSchema.parse(input.dashboardLanguage),
        installationRoleSchema.parse(input.installationRole),
        z.boolean().parse(input.emailVerified),
      ],
    );
    return parseUser(result.rows[0]);
  }

  public async findUserByEmail(email: string): Promise<StoredDashboardUser | undefined> {
    const result = await this.#database.query(
      `SELECT user_id, email, password_hash, dashboard_language, dashboard_theme,
              installation_role, email_verified_at
       FROM dashboard_users WHERE email = $1`,
      [z.string().email().parse(email)],
    );
    return result.rows[0] === undefined ? undefined : parseUser(result.rows[0]);
  }

  public async findUserById(userId: string): Promise<StoredDashboardUser | undefined> {
    const result = await this.#database.query(
      `SELECT user_id, email, password_hash, dashboard_language, dashboard_theme,
              installation_role, email_verified_at
       FROM dashboard_users WHERE user_id = $1`,
      [identifierSchema.parse(userId)],
    );
    return result.rows[0] === undefined ? undefined : parseUser(result.rows[0]);
  }

  public async replaceAuthToken(input: {
    expiresAt: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    tokenId: string;
    userId: string;
  }): Promise<void> {
    await this.#database.query(
      `WITH invalidated AS (
         UPDATE dashboard_auth_tokens SET consumed_at = now()
         WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL
       )
       INSERT INTO dashboard_auth_tokens (
         token_id, user_id, purpose, token_hash, expires_at
       ) VALUES ($3, $1, $2, $4, $5)`,
      [
        identifierSchema.parse(input.userId),
        tokenPurposeSchema.parse(input.purpose),
        identifierSchema.parse(input.tokenId),
        z.string().min(1).parse(input.tokenHash),
        dateSchema.parse(input.expiresAt),
      ],
    );
  }

  public async consumeAuthToken(input: {
    now: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
  }): Promise<StoredDashboardUser | undefined> {
    const result = await this.#database.query(
      `WITH consumed AS (
         UPDATE dashboard_auth_tokens
         SET consumed_at = $3
         WHERE token_hash = $1
           AND purpose = $2
           AND consumed_at IS NULL
           AND expires_at > $3
         RETURNING user_id
       ), updated_user AS (
         UPDATE dashboard_users AS users
         SET email_verified_at = CASE
               WHEN $2 = 'email_verification' THEN COALESCE(users.email_verified_at, $3)
               ELSE users.email_verified_at
             END,
             updated_at = now()
         FROM consumed
         WHERE users.user_id = consumed.user_id
         RETURNING users.user_id, users.email, users.password_hash,
                   users.dashboard_language, users.dashboard_theme, users.installation_role,
                   users.email_verified_at
       )
       SELECT * FROM updated_user`,
      [
        z.string().min(1).parse(input.tokenHash),
        tokenPurposeSchema.parse(input.purpose),
        dateSchema.parse(input.now),
      ],
    );
    return result.rows[0] === undefined ? undefined : parseUser(result.rows[0]);
  }

  public async replacePasswordAndRevokeSessions(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.#database.query(
      `WITH updated_user AS (
         UPDATE dashboard_users
         SET password_hash = $2, updated_at = now()
         WHERE user_id = $1
         RETURNING user_id
       )
       UPDATE dashboard_sessions session
       SET revoked_at = COALESCE(session.revoked_at, now())
       FROM updated_user
       WHERE session.user_id = updated_user.user_id`,
      [identifierSchema.parse(userId), z.string().min(1).parse(passwordHash)],
    );
  }

  public async updatePreferences(
    userId: string,
    preferences: { dashboardLanguage: "en" | "pt-BR"; dashboardTheme: "system" | "light" | "dark" },
  ): Promise<void> {
    await this.#database.query(
      `UPDATE dashboard_users
       SET dashboard_language = $2, dashboard_theme = $3, updated_at = now()
       WHERE user_id = $1`,
      [
        identifierSchema.parse(userId),
        dashboardLanguageSchema.parse(preferences.dashboardLanguage),
        dashboardThemeSchema.parse(preferences.dashboardTheme),
      ],
    );
  }

  public async createSession(input: {
    expiresAt: string;
    refreshTokenHash: string;
    sessionId: string;
    userId: string;
  }): Promise<void> {
    await this.#database.query(
      `INSERT INTO dashboard_sessions (
         session_id, user_id, refresh_token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [
        identifierSchema.parse(input.sessionId),
        identifierSchema.parse(input.userId),
        z.string().min(1).parse(input.refreshTokenHash),
        dateSchema.parse(input.expiresAt),
      ],
    );
  }

  public async findActiveSession(input: {
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<StoredSession | undefined> {
    const result = await this.#database.query(
      `SELECT session_id, user_id FROM dashboard_sessions
       WHERE session_id = $1 AND user_id = $2
         AND revoked_at IS NULL AND expires_at > $3`,
      [
        identifierSchema.parse(input.sessionId),
        identifierSchema.parse(input.userId),
        dateSchema.parse(input.now),
      ],
    );
    return result.rows[0] === undefined ? undefined : parseSession(result.rows[0]);
  }

  public async rotateSession(input: {
    currentRefreshTokenHash: string;
    expiresAt: string;
    newRefreshTokenHash: string;
    now: string;
  }): Promise<StoredSession | undefined> {
    const result = await this.#database.query(
      `UPDATE dashboard_sessions
       SET refresh_token_hash = $2, expires_at = $3, last_used_at = $4
       WHERE refresh_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > $4
       RETURNING session_id, user_id`,
      [
        z.string().min(1).parse(input.currentRefreshTokenHash),
        z.string().min(1).parse(input.newRefreshTokenHash),
        dateSchema.parse(input.expiresAt),
        dateSchema.parse(input.now),
      ],
    );
    return result.rows[0] === undefined ? undefined : parseSession(result.rows[0]);
  }

  public async revokeSession(sessionId: string): Promise<void> {
    await this.#database.query(
      `UPDATE dashboard_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL`,
      [identifierSchema.parse(sessionId)],
    );
  }

  public async revokeAllSessions(userId: string): Promise<void> {
    await this.#database.query(
      `UPDATE dashboard_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [identifierSchema.parse(userId)],
    );
  }
}

function parseUser(input: unknown): StoredDashboardUser {
  const row = userRowSchema.parse(input);
  return {
    dashboardLanguage: row.dashboard_language,
    dashboardTheme: row.dashboard_theme,
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    installationRole: row.installation_role,
    passwordHash: row.password_hash,
    userId: row.user_id,
  };
}

function parseSession(input: unknown): StoredSession {
  const row = sessionRowSchema.parse(input);
  return { sessionId: row.session_id, userId: row.user_id };
}
