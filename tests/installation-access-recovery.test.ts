import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  InstallationAccessRecoveryError,
  InstallationAccessRecoveryService,
} from "../src/auth/installation-access-recovery.js";

describe("InstallationAccessRecoveryService", () => {
  const recoveryToken = "one-time-recovery-token-with-enough-entropy";

  it("creates a single-use recovery token that expires after ten minutes", async () => {
    const repository = {
      consumeRecoveryToken: vi.fn(),
      createRecoveryToken: vi.fn(async () => undefined),
    };
    const service = new InstallationAccessRecoveryService({
      hasher: { hash: vi.fn(), verify: vi.fn() },
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      randomToken: () => recoveryToken,
      repository,
    });

    await expect(service.create()).resolves.toBe(recoveryToken);
    expect(repository.createRecoveryToken).toHaveBeenCalledWith({
      expiresAt: "2026-09-09T12:10:00.000Z",
      tokenHash: createHash("sha256").update(recoveryToken).digest("base64url"),
    });
    expect(JSON.stringify(repository.createRecoveryToken.mock.calls)).not.toContain(recoveryToken);
  });

  it("atomically consumes recovery and replaces the password", async () => {
    const repository = {
      consumeRecoveryToken: vi.fn(async () => true),
      createRecoveryToken: vi.fn(),
    };
    const hasher = { hash: vi.fn(async () => "new-password-hash"), verify: vi.fn() };
    const service = new InstallationAccessRecoveryService({
      hasher,
      now: () => new Date("2026-09-09T12:00:00.000Z"),
      repository,
    });

    await service.recover(recoveryToken, "uma nova frase segura para acesso");

    expect(repository.consumeRecoveryToken).toHaveBeenCalledWith({
      now: "2026-09-09T12:00:00.000Z",
      passwordHash: "new-password-hash",
      tokenHash: createHash("sha256").update(recoveryToken).digest("base64url"),
    });
  });

  it("rejects an expired or already consumed recovery token", async () => {
    const service = new InstallationAccessRecoveryService({
      hasher: { hash: vi.fn(async () => "hash"), verify: vi.fn() },
      repository: {
        consumeRecoveryToken: vi.fn(async () => false),
        createRecoveryToken: vi.fn(),
      },
    });

    await expect(
      service.recover("expired-token", "uma nova frase segura para acesso"),
    ).rejects.toEqual(new InstallationAccessRecoveryError());
  });
});
