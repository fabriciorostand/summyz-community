import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { lockModelLifecycle } from "../src/models/model-lifecycle-lock.js";

describe("model lifecycle exclusion", () => {
  it("refuses concurrent lifecycle changes without holding a waiting database connection", async () => {
    const query = vi
      .fn<PostgresExecutor["query"]>()
      .mockResolvedValue({ rows: [{ acquired: false }], rowCount: 1 });
    await expect(lockModelLifecycle({ query })).rejects.toMatchObject({
      code: "model_lifecycle_busy",
    });
    expect(query.mock.calls[0]?.[0]).toContain("pg_try_advisory_xact_lock");
    query.mockResolvedValue({ rows: [{ acquired: true }], rowCount: 1 });
    await expect(lockModelLifecycle({ query })).resolves.toBeUndefined();
  });
});
