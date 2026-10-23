import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresInstallationAccessStore } from "../src/database/postgres-installation-access-store.js";

describe("PostgresInstallationAccessStore", () => {
  it("initializes only one installation password", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ singleton: true }],
    });
    const store = new PostgresInstallationAccessStore({ query });

    await expect(store.initialize("argon2id-hash")).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (singleton) DO NOTHING");
  });

  it("replaces the password and revokes existing sessions atomically", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ singleton: true }],
    });
    const store = new PostgresInstallationAccessStore({ query });

    await expect(store.replace("old-hash", "new-hash")).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("revoked_sessions");
    expect(query.mock.calls[0]?.[0]).toContain("password_hash = $1");
  });

  it("consumes recovery only once before expiration and revokes sessions", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ singleton: true }],
    });
    const store = new PostgresInstallationAccessStore({ query });

    await expect(
      store.consumeRecoveryToken({
        now: "2026-09-09T12:00:00.000Z",
        passwordHash: "new-hash",
        tokenHash: "recovery-hash",
      }),
    ).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("consumed_at IS NULL");
    expect(query.mock.calls[0]?.[0]).toContain("expires_at > $2");
    expect(query.mock.calls[0]?.[0]).toContain("revoked_sessions");
  });
});
