import { describe, expect, it, vi } from "vitest";

import { PostgresAuthRepository } from "../src/database/postgres-auth-repository.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

const row = {
  dashboard_language: "pt-BR",
  dashboard_theme: "system",
  email: "person@example.com",
  email_verified_at: "2026-08-27T10:00:00.000Z",
  installation_role: "member",
  password_hash: "$argon2id$hash",
  user_id: "9ad6cc98-5301-498c-a72c-f9b92f21f6dc",
};

describe("PostgresAuthRepository", () => {
  it("creates and validates a normalized dashboard user", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValue({ rowCount: 1, rows: [row] });
    const repository = new PostgresAuthRepository({ query });

    await expect(
      repository.createUser({
        dashboardLanguage: "pt-BR",
        email: "person@example.com",
        emailVerified: true,
        installationRole: "member",
        passwordHash: "$argon2id$hash",
        userId: row.user_id,
      }),
    ).resolves.toMatchObject({ email: "person@example.com", emailVerified: true });
    expect(query.mock.calls[0]?.[0]).toMatch(/INSERT INTO dashboard_users/i);
  });

  it("consumes an unexpired token and verifies email atomically", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValue({ rowCount: 1, rows: [row] });
    const repository = new PostgresAuthRepository({ query });

    await repository.consumeAuthToken({
      now: "2026-08-27T10:00:00.000Z",
      purpose: "email_verification",
      tokenHash: "safe-hash",
    });

    expect(query.mock.calls[0]?.[0]).toMatch(/consumed_at/i);
    expect(query.mock.calls[0]?.[0]).toMatch(/email_verified_at/i);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "safe-hash",
      "email_verification",
      "2026-08-27T10:00:00.000Z",
    ]);
  });

  it("rotates only a valid active refresh token", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ session_id: "session-1", user_id: row.user_id }],
    });
    const repository = new PostgresAuthRepository({ query });

    await expect(
      repository.rotateSession({
        currentRefreshTokenHash: "old-hash",
        expiresAt: "2026-09-27T10:00:00.000Z",
        newRefreshTokenHash: "new-hash",
        now: "2026-08-27T10:00:00.000Z",
      }),
    ).resolves.toEqual({ sessionId: "session-1", userId: row.user_id });
    expect(query.mock.calls[0]?.[0]).toMatch(/refresh_token_hash = \$2/i);
  });

  it("updates account preferences atomically", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new PostgresAuthRepository({ query });

    await repository.updatePreferences(row.user_id, {
      dashboardLanguage: "en",
      dashboardTheme: "dark",
    });

    expect(query).toHaveBeenCalledWith(expect.stringContaining("dashboard_theme = $3"), [
      row.user_id,
      "en",
      "dark",
    ]);
  });

  it("changes the password and revokes all sessions in one statement", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const repository = new PostgresAuthRepository({ query });

    await repository.replacePasswordAndRevokeSessions(row.user_id, "$argon2id$new-hash");

    expect(query.mock.calls[0]?.[0]).toContain("WITH updated_user AS");
    expect(query.mock.calls[0]?.[0]).toContain("UPDATE dashboard_sessions");
    expect(query.mock.calls[0]?.[1]).toEqual([row.user_id, "$argon2id$new-hash"]);
  });
});
