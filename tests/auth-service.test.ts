import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  type AuthRepository,
  AuthService,
  type StoredDashboardUser,
} from "../src/auth/auth-service.js";
import type { PasswordHasher } from "../src/auth/password-hasher.js";

const user: StoredDashboardUser = {
  dashboardLanguage: "pt-BR",
  dashboardTheme: "system",
  email: "person@example.com",
  emailVerified: true,
  installationRole: "member",
  passwordHash: "hashed-password",
  userId: "user-1",
};

function createFixture(overrides: { storedUser?: StoredDashboardUser } = {}) {
  const repository: AuthRepository = {
    consumeAuthToken: vi.fn(async () => overrides.storedUser ?? user),
    createSession: vi.fn(async () => undefined),
    createUser: vi.fn(async () => overrides.storedUser ?? user),
    findActiveSession: vi.fn(async () => ({ sessionId: "session-1", userId: "user-1" })),
    findUserByEmail: vi.fn(async () => overrides.storedUser ?? user),
    findUserById: vi.fn(async () => overrides.storedUser ?? user),
    replaceAuthToken: vi.fn(async () => undefined),
    replacePasswordAndRevokeSessions: vi.fn(async () => undefined),
    revokeAllSessions: vi.fn(async () => undefined),
    revokeSession: vi.fn(async () => undefined),
    rotateSession: vi.fn(async () => ({ sessionId: "session-1", userId: "user-1" })),
    updatePreferences: vi.fn(async () => undefined),
  };
  const hasher: PasswordHasher = {
    hash: vi.fn(async () => "hashed-password"),
    verify: vi.fn(async () => true),
  };
  const email = {
    sendPasswordReset: vi.fn(async () => undefined),
    sendVerification: vi.fn(async () => undefined),
  };
  const jwt = {
    sign: vi.fn(async () => "access-token"),
    verify: vi.fn(async () => ({ sessionId: "session-1", userId: "user-1" })),
  };
  const service = new AuthService({
    email,
    hasher,
    jwt,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    repository,
  });
  return { email, hasher, jwt, repository, service };
}

describe("AuthService", () => {
  it("registers a normalized member and sends a single-use verification token", async () => {
    const { email, repository, service } = createFixture();

    await service.register({
      dashboardLanguage: "pt-BR",
      email: " Person@Example.COM ",
      password: "correct horse battery staple",
    });

    expect(repository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "person@example.com",
        installationRole: "member",
        passwordHash: "hashed-password",
      }),
    );
    expect(repository.replaceAuthToken).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "email_verification", tokenHash: expect.any(String) }),
    );
    expect(email.sendVerification).toHaveBeenCalledWith(
      expect.objectContaining({ email: "person@example.com", token: expect.any(String) }),
    );
  });

  it("creates JWT and rotating refresh credentials only for verified users", async () => {
    const { repository, service } = createFixture();

    const result = await service.login("person@example.com", "correct horse battery staple");

    expect(result).toMatchObject({ accessToken: "access-token", refreshToken: expect.any(String) });
    expect(repository.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ refreshTokenHash: expect.any(String), userId: "user-1" }),
    );
  });

  it("rejects an unverified account without issuing a session", async () => {
    const { repository, service } = createFixture({
      storedUser: { ...user, emailVerified: false },
    });

    await expect(
      service.login("person@example.com", "correct horse battery staple"),
    ).rejects.toMatchObject({ code: "email_not_verified" });
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it("does not reveal whether a password-reset email exists", async () => {
    const { email, repository, service } = createFixture();
    vi.mocked(repository.findUserByEmail).mockResolvedValueOnce(undefined);

    await expect(service.requestPasswordReset("missing@example.com")).resolves.toBeUndefined();
    expect(email.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("rejects invalid credentials with one safe error", async () => {
    const { hasher, service } = createFixture();
    vi.mocked(hasher.verify).mockResolvedValueOnce(false);

    await expect(service.login("person@example.com", "wrong password here")).rejects.toEqual(
      new AuthenticationError("invalid_credentials"),
    );
  });

  it("creates the initial verified administrator", async () => {
    const { repository, service } = createFixture();

    await service.createInitialAdministrator({
      dashboardLanguage: "en",
      email: " Admin@Example.com ",
      password: "correct horse battery staple",
    });

    expect(repository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardLanguage: "en",
        email: "admin@example.com",
        emailVerified: true,
        installationRole: "administrator",
      }),
    );
  });

  it("consumes verification tokens and rejects invalid ones", async () => {
    const { repository, service } = createFixture();

    await expect(service.verifyEmail("valid-token")).resolves.toBeUndefined();
    vi.mocked(repository.consumeAuthToken).mockResolvedValueOnce(undefined);
    await expect(service.verifyEmail("invalid-token")).rejects.toEqual(
      new AuthenticationError("invalid_or_expired_token"),
    );
  });

  it("rejects login for an unknown email without hashing disclosure", async () => {
    const { hasher, repository, service } = createFixture();
    vi.mocked(repository.findUserByEmail).mockResolvedValueOnce(undefined);

    await expect(service.login("missing@example.com", "wrong password here")).rejects.toEqual(
      new AuthenticationError("invalid_credentials"),
    );
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it("rotates refresh sessions and rejects an expired refresh token", async () => {
    const { repository, service } = createFixture();

    await expect(service.refresh("current-refresh-token")).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: expect.any(String),
    });
    vi.mocked(repository.rotateSession).mockResolvedValueOnce(undefined);
    await expect(service.refresh("expired-refresh-token")).rejects.toEqual(
      new AuthenticationError("session_expired"),
    );
  });

  it("authenticates active sessions and rejects missing session state", async () => {
    const { repository, service } = createFixture();

    await expect(service.authenticate("access-token")).resolves.toEqual({
      dashboardLanguage: "pt-BR",
      dashboardTheme: "system",
      email: "person@example.com",
      emailVerified: true,
      installationRole: "member",
      userId: "user-1",
    });
    vi.mocked(repository.findActiveSession).mockResolvedValueOnce(undefined);
    await expect(service.authenticate("access-token")).rejects.toEqual(
      new AuthenticationError("session_expired"),
    );
    vi.mocked(repository.findUserById).mockResolvedValueOnce(undefined);
    await expect(service.authenticate("access-token")).rejects.toEqual(
      new AuthenticationError("session_expired"),
    );
  });

  it("revokes the access session on logout", async () => {
    const { repository, service } = createFixture();

    await service.logout("access-token");

    expect(repository.revokeSession).toHaveBeenCalledWith("session-1");
  });

  it("sends and consumes password-reset tokens before revoking every session", async () => {
    const { email, repository, service } = createFixture();

    await service.requestPasswordReset("person@example.com");
    expect(email.sendPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ email: "person@example.com", token: expect.any(String) }),
    );
    await service.resetPassword("reset-token", "another secure password");
    expect(repository.replacePasswordAndRevokeSessions).toHaveBeenCalledWith(
      "user-1",
      "hashed-password",
    );

    vi.mocked(repository.consumeAuthToken).mockResolvedValueOnce(undefined);
    await expect(service.resetPassword("expired-token", "another secure password")).rejects.toEqual(
      new AuthenticationError("invalid_or_expired_token"),
    );
  });

  it("changes an authenticated password only after verifying the current password", async () => {
    const { hasher, repository, service } = createFixture();

    await service.changePassword("user-1", "current secure password", "new secure password");

    expect(hasher.verify).toHaveBeenCalledWith("hashed-password", "current secure password");
    expect(repository.replacePasswordAndRevokeSessions).toHaveBeenCalledWith(
      "user-1",
      "hashed-password",
    );

    vi.mocked(hasher.verify).mockResolvedValueOnce(false);
    await expect(
      service.changePassword("user-1", "wrong current password", "new secure password"),
    ).rejects.toEqual(new AuthenticationError("invalid_credentials"));
  });

  it("persists language and theme preferences on the account", async () => {
    const { repository, service } = createFixture();

    await service.updatePreferences("user-1", {
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });

    expect(repository.updatePreferences).toHaveBeenCalledWith("user-1", {
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });
  });
});
