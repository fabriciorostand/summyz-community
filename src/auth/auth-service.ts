import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { z } from "zod";

import {
  type AuthenticatedUser,
  dashboardLanguageSchema,
  dashboardThemeSchema,
  type installationRoleSchema,
  normalizeEmailAddress,
  passwordSchema,
} from "./auth-domain.js";
import type { SessionClaims } from "./jwt-session.js";
import type { PasswordHasher } from "./password-hasher.js";

type InstallationRole = z.infer<typeof installationRoleSchema>;
export type AuthTokenPurpose = "email_verification" | "password_reset";

export interface StoredDashboardUser extends AuthenticatedUser {
  passwordHash: string;
}

export interface StoredSession {
  sessionId: string;
  userId: string;
}

export interface AuthRepository {
  consumeAuthToken(input: {
    now: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
  }): Promise<StoredDashboardUser | undefined>;
  createSession(input: {
    expiresAt: string;
    refreshTokenHash: string;
    sessionId: string;
    userId: string;
  }): Promise<void>;
  createUser(input: {
    dashboardLanguage: "en" | "pt-BR";
    email: string;
    emailVerified: boolean;
    installationRole: InstallationRole;
    passwordHash: string;
    userId: string;
  }): Promise<StoredDashboardUser>;
  findActiveSession(input: {
    now: string;
    sessionId: string;
    userId: string;
  }): Promise<StoredSession | undefined>;
  findUserByEmail(email: string): Promise<StoredDashboardUser | undefined>;
  findUserById(userId: string): Promise<StoredDashboardUser | undefined>;
  replaceAuthToken(input: {
    expiresAt: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    tokenId: string;
    userId: string;
  }): Promise<void>;
  replacePasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;
  rotateSession(input: {
    currentRefreshTokenHash: string;
    expiresAt: string;
    newRefreshTokenHash: string;
    now: string;
  }): Promise<StoredSession | undefined>;
  updatePreferences(
    userId: string,
    preferences: { dashboardLanguage: "en" | "pt-BR"; dashboardTheme: "system" | "light" | "dark" },
  ): Promise<void>;
}

export interface AuthenticationEmailSender {
  sendPasswordReset(input: { email: string; token: string }): Promise<void>;
  sendVerification(input: { email: string; token: string }): Promise<void>;
}

interface AccessTokenSigner {
  sign(input: SessionClaims): Promise<string>;
  verify(token: string): Promise<SessionClaims>;
}

interface AuthServiceOptions {
  email: AuthenticationEmailSender;
  hasher: PasswordHasher;
  jwt: AccessTokenSigner;
  now?: () => Date;
  repository: AuthRepository;
}

export type AuthenticationErrorCode =
  | "email_not_verified"
  | "invalid_credentials"
  | "invalid_or_expired_token"
  | "session_expired";

export class AuthenticationError extends Error {
  public readonly code: AuthenticationErrorCode;

  public constructor(code: AuthenticationErrorCode) {
    super(code);
    this.code = code;
    this.name = "AuthenticationError";
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export class AuthService {
  readonly #email: AuthenticationEmailSender;
  readonly #hasher: PasswordHasher;
  readonly #jwt: AccessTokenSigner;
  readonly #now: () => Date;
  readonly #repository: AuthRepository;

  public constructor(options: AuthServiceOptions) {
    this.#email = options.email;
    this.#hasher = options.hasher;
    this.#jwt = options.jwt;
    this.#now = options.now ?? (() => new Date());
    this.#repository = options.repository;
  }

  public async register(input: {
    dashboardLanguage: "en" | "pt-BR";
    email: string;
    password: string;
  }): Promise<void> {
    const passwordHash = await this.#hasher.hash(passwordSchema.parse(input.password));
    const registered = await this.#repository.createUser({
      dashboardLanguage: dashboardLanguageSchema.parse(input.dashboardLanguage),
      email: normalizeEmailAddress(input.email),
      emailVerified: false,
      installationRole: "member",
      passwordHash,
      userId: randomUUID(),
    });
    await this.#sendAuthToken(registered, "email_verification");
  }

  public async createInitialAdministrator(input: {
    dashboardLanguage: "en" | "pt-BR";
    email: string;
    password: string;
  }): Promise<StoredDashboardUser> {
    const passwordHash = await this.#hasher.hash(passwordSchema.parse(input.password));
    return this.#repository.createUser({
      dashboardLanguage: dashboardLanguageSchema.parse(input.dashboardLanguage),
      email: normalizeEmailAddress(input.email),
      emailVerified: true,
      installationRole: "administrator",
      passwordHash,
      userId: randomUUID(),
    });
  }

  public async verifyEmail(token: string): Promise<void> {
    const verified = await this.#repository.consumeAuthToken({
      now: this.#now().toISOString(),
      purpose: "email_verification",
      tokenHash: hashToken(token),
    });
    if (verified === undefined) throw new AuthenticationError("invalid_or_expired_token");
  }

  public async login(email: string, password: string): Promise<AuthTokens> {
    const stored = await this.#repository.findUserByEmail(normalizeEmailAddress(email));
    if (stored === undefined || !(await this.#hasher.verify(stored.passwordHash, password))) {
      throw new AuthenticationError("invalid_credentials");
    }
    if (!stored.emailVerified) throw new AuthenticationError("email_not_verified");
    return this.#createSession(stored.userId);
  }

  public async refresh(refreshToken: string): Promise<AuthTokens> {
    const newRefreshToken = createRawToken();
    const rotated = await this.#repository.rotateSession({
      currentRefreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(this.#now().getTime() + 30 * DAY_MS).toISOString(),
      newRefreshTokenHash: hashToken(newRefreshToken),
      now: this.#now().toISOString(),
    });
    if (rotated === undefined) throw new AuthenticationError("session_expired");
    return {
      accessToken: await this.#jwt.sign(rotated),
      refreshToken: newRefreshToken,
    };
  }

  public async authenticate(accessToken: string): Promise<AuthenticatedUser> {
    const claims = await this.#jwt.verify(accessToken);
    const session = await this.#repository.findActiveSession({
      now: this.#now().toISOString(),
      sessionId: claims.sessionId,
      userId: claims.userId,
    });
    if (session === undefined) throw new AuthenticationError("session_expired");
    const stored = await this.#repository.findUserById(claims.userId);
    if (stored === undefined) throw new AuthenticationError("session_expired");
    return toAuthenticatedUser(stored);
  }

  public async logout(accessToken: string): Promise<void> {
    const claims = await this.#jwt.verify(accessToken);
    await this.#repository.revokeSession(claims.sessionId);
  }

  public async requestPasswordReset(email: string): Promise<void> {
    const stored = await this.#repository.findUserByEmail(normalizeEmailAddress(email));
    if (stored === undefined) return;
    await this.#sendAuthToken(stored, "password_reset");
  }

  public async resetPassword(token: string, password: string): Promise<void> {
    const stored = await this.#repository.consumeAuthToken({
      now: this.#now().toISOString(),
      purpose: "password_reset",
      tokenHash: hashToken(token),
    });
    if (stored === undefined) throw new AuthenticationError("invalid_or_expired_token");
    await this.#repository.replacePasswordAndRevokeSessions(
      stored.userId,
      await this.#hasher.hash(passwordSchema.parse(password)),
    );
  }

  public async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const stored = await this.#repository.findUserById(userId);
    if (
      stored === undefined ||
      !(await this.#hasher.verify(stored.passwordHash, passwordSchema.parse(currentPassword)))
    ) {
      throw new AuthenticationError("invalid_credentials");
    }
    await this.#repository.replacePasswordAndRevokeSessions(
      stored.userId,
      await this.#hasher.hash(passwordSchema.parse(newPassword)),
    );
  }

  public async updatePreferences(
    userId: string,
    preferences: { dashboardLanguage: "en" | "pt-BR"; dashboardTheme: "system" | "light" | "dark" },
  ): Promise<void> {
    await this.#repository.updatePreferences(userId, {
      dashboardLanguage: dashboardLanguageSchema.parse(preferences.dashboardLanguage),
      dashboardTheme: dashboardThemeSchema.parse(preferences.dashboardTheme),
    });
  }

  async #createSession(userId: string): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const refreshToken = createRawToken();
    await this.#repository.createSession({
      expiresAt: new Date(this.#now().getTime() + 30 * DAY_MS).toISOString(),
      refreshTokenHash: hashToken(refreshToken),
      sessionId,
      userId,
    });
    return {
      accessToken: await this.#jwt.sign({ sessionId, userId }),
      refreshToken,
    };
  }

  async #sendAuthToken(user: StoredDashboardUser, purpose: AuthTokenPurpose): Promise<void> {
    const token = createRawToken();
    await this.#repository.replaceAuthToken({
      expiresAt: new Date(
        this.#now().getTime() + (purpose === "email_verification" ? DAY_MS : 60 * 60 * 1_000),
      ).toISOString(),
      purpose,
      tokenHash: hashToken(token),
      tokenId: randomUUID(),
      userId: user.userId,
    });
    if (purpose === "email_verification") {
      await this.#email.sendVerification({ email: user.email, token });
    } else {
      await this.#email.sendPasswordReset({ email: user.email, token });
    }
  }
}

function createRawToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function toAuthenticatedUser(user: StoredDashboardUser): AuthenticatedUser {
  return {
    dashboardLanguage: user.dashboardLanguage,
    dashboardTheme: user.dashboardTheme,
    email: user.email,
    emailVerified: user.emailVerified,
    installationRole: user.installationRole,
    userId: user.userId,
  };
}
