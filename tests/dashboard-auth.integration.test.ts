import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { DashboardSessionError, DashboardSessionService } from "../src/auth/dashboard-session.js";
import { PostgresDashboardSessionStore } from "../src/database/postgres-dashboard-session-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresDiscordConnectionStore } from "../src/database/postgres-discord-connection-store.js";
import { SecretBox } from "../src/security/secret-box.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("Discord dashboard auth in real PostgreSQL", () => {
  it("atomically replaces the owner and invalidates the previous owner's sessions", async () => {
    const admin = new Pool({ connectionString: connectionString ?? "postgresql://invalid" });
    const schemaName = `dashboard_auth_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const database = createPostgresDatabase(withSearchPath(connectionString, schemaName));

    try {
      await database.initialize();
      const secretBox = new SecretBox(Buffer.alloc(32, 23).toString("base64url"));
      const connections = new PostgresDiscordConnectionStore({ database, secretBox });
      const sessions = new DashboardSessionService({
        repository: new PostgresDashboardSessionStore(database),
      });

      await expect(
        connections.replaceConnection(connection("alice", "Alice"), {
          allowAnyOwner: true,
          expectedOwnerDiscordUserId: null,
        }),
      ).resolves.toBe(true);
      const aliceSession = await sessions.create("alice");
      await expect(sessions.authenticate(aliceSession)).resolves.toMatchObject({
        discordUsername: "Alice",
        userId: "alice",
      });

      await expect(
        connections.replaceConnection(connection("bob", "Bob"), {
          allowAnyOwner: false,
          expectedOwnerDiscordUserId: "alice",
        }),
      ).resolves.toBe(true);
      await expect(sessions.authenticate(aliceSession)).rejects.toBeInstanceOf(
        DashboardSessionError,
      );
      const bobSession = await sessions.create("bob");
      await expect(sessions.authenticate(bobSession)).resolves.toMatchObject({
        discordUsername: "Bob",
        userId: "bob",
      });
    } finally {
      await database.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });
});

function connection(discordUserId: string, discordUsername: string) {
  return {
    credentials: {
      accessToken: `access-${discordUserId}`,
      expiresAt: "2026-10-09T12:00:00.000Z",
      refreshToken: `refresh-${discordUserId}`,
      scope: "identify guilds",
    },
    discordAvatar: null,
    discordUserId,
    discordUsername,
  };
}

function withSearchPath(url: string | undefined, schemaName: string): string {
  const parsed = new URL(url ?? "postgresql://invalid");
  parsed.searchParams.set("options", `-c search_path=${schemaName}`);
  return parsed.toString();
}
