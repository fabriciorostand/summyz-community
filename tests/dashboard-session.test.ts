import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DashboardSessionError, DashboardSessionService } from "../src/auth/dashboard-session.js";

const access = {
  dashboardLanguage: "pt-BR" as const,
  dashboardTheme: "system" as const,
};

describe("DashboardSessionService", () => {
  it("creates a seven-day idle session with a 30-day absolute limit", async () => {
    const repository = {
      createSession: vi.fn(async () => undefined),
      findAndRefreshSession: vi.fn(),
      revokeSession: vi.fn(),
    };
    const service = new DashboardSessionService({
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      randomToken: () => "opaque-session-token",
      repository,
    });

    await expect(service.create()).resolves.toBe("opaque-session-token");
    expect(repository.createSession).toHaveBeenCalledWith({
      absoluteExpiresAt: "2026-10-09T12:00:00.000Z",
      expiresAt: "2026-09-16T12:00:00.000Z",
      tokenHash: createHash("sha256").update("opaque-session-token").digest("base64url"),
    });
    expect(JSON.stringify(repository.createSession.mock.calls)).not.toContain(
      '"opaque-session-token"',
    );
  });

  it("renews an active session for seven days while returning global preferences", async () => {
    const repository = {
      createSession: vi.fn(),
      findAndRefreshSession: vi.fn(async () => access),
      revokeSession: vi.fn(),
    };
    const service = new DashboardSessionService({
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      repository,
    });

    await expect(service.authenticate("opaque-session-token")).resolves.toEqual(access);
    expect(repository.findAndRefreshSession).toHaveBeenCalledWith({
      expiresAt: "2026-09-16T12:00:00.000Z",
      now: "2026-09-09T12:00:00.000Z",
      tokenHash: createHash("sha256").update("opaque-session-token").digest("base64url"),
    });
  });

  it("rejects an expired or owner-invalidated session", async () => {
    const repository = {
      createSession: vi.fn(),
      findAndRefreshSession: vi.fn(async () => undefined),
      revokeSession: vi.fn(),
    };
    const service = new DashboardSessionService({ repository });

    await expect(service.authenticate("expired-token")).rejects.toEqual(
      new DashboardSessionError(),
    );
  });

  it("revokes logout by hash without exposing the raw cookie", async () => {
    const repository = {
      createSession: vi.fn(),
      findAndRefreshSession: vi.fn(),
      revokeSession: vi.fn(async () => undefined),
    };
    const service = new DashboardSessionService({ repository });

    await service.logout("opaque-session-token");

    expect(repository.revokeSession).toHaveBeenCalledWith(
      createHash("sha256").update("opaque-session-token").digest("base64url"),
    );
  });
});
