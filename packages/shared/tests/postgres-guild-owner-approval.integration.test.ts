import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresGuildOwnerApprovalStore } from "../src/database/postgres-guild-owner-approval-store.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("guild owner approvals in real PostgreSQL", () => {
  it("persists first observation, owner transfer and explicit confirmation", async () => {
    const { database, cleanup } = await createIsolatedDatabase(connectionString);
    try {
      const approvals = new PostgresGuildOwnerApprovalStore(database);
      expect(await approvals.isConfirmed("guild-owner-test", "owner-a")).toBe(true);
      expect(await approvals.isConfirmed("guild-owner-test", "owner-a")).toBe(true);
      expect(await approvals.isConfirmed("guild-owner-test", "owner-b")).toBe(false);
      expect(await approvals.confirm("guild-owner-test", "owner-a")).toBe(false);
      expect(await approvals.confirm("guild-owner-test", "owner-b")).toBe(true);
      expect(await approvals.isConfirmed("guild-owner-test", "owner-b")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("observes a concurrent first insert without losing the owner row", async () => {
    const { database, cleanup, connectionUrl } = await createIsolatedDatabase(connectionString);
    const blocker = new Pool({ connectionString: connectionUrl });
    const client = await blocker.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO guild_owner_approvals (guild_id, owner_user_id, confirmed) VALUES ($1, $2, true)",
        ["guild-concurrent", "owner-a"],
      );
      const approvals = new PostgresGuildOwnerApprovalStore(database);
      const observation = approvals.isConfirmed("guild-concurrent", "owner-a");
      await delay(100);
      await client.query("COMMIT");
      await expect(observation).resolves.toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await blocker.end();
      await cleanup();
    }
  });
});

async function createIsolatedDatabase(base: string | undefined) {
  if (base === undefined) throw new Error("POSTGRES_TEST_URL is required");
  const schema = `approval_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: base });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scopedUrl = new URL(base);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const connectionUrl = scopedUrl.toString();
  const database = createPostgresDatabase(connectionUrl);
  try {
    await database.initialize();
  } catch (error) {
    await database.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    connectionUrl,
    database,
    cleanup: async () => {
      await database.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
