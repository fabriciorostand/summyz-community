import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresGuildOwnerApprovalStore } from "../src/database/postgres-guild-owner-approval-store.js";

describe("PostgresGuildOwnerApprovalStore", () => {
  it("records the first observed owner while preserving existing configurations", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [{ confirmed: true }],
    });
    const store = new PostgresGuildOwnerApprovalStore({ query });

    await expect(store.isConfirmed("guild-1", "owner-a")).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("guild_owner_approvals");
    expect(query.mock.calls[0]?.[0]).toContain("confirmed = CASE");
  });

  it("only confirms settings for the observed owner", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({ rowCount: 1, rows: [] });
    const store = new PostgresGuildOwnerApprovalStore({ query });
    await expect(store.confirm("guild-1", "owner-b")).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("owner_user_id = $2");
    expect(query.mock.calls[0]?.[0]).not.toContain("processing_jobs");
  });

  it("returns false after ownership changes and refuses confirmation for an outdated owner", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ confirmed: false }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const store = new PostgresGuildOwnerApprovalStore({ query });

    await expect(store.isConfirmed("guild-1", "owner-b")).resolves.toBe(false);
    await expect(store.confirm("guild-1", "owner-a")).resolves.toBe(false);
    expect(query.mock.calls[1]?.[0]).toContain("owner_user_id = $2");
  });
});
