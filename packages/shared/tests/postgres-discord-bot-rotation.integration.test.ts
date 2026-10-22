import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresDashboardSessionStore } from "../src/database/postgres-dashboard-session-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresGuildOwnerApprovalStore } from "../src/database/postgres-guild-owner-approval-store.js";
import { PostgresInstallationDiscordConnectionStore } from "../src/database/postgres-installation-discord-connection-store.js";
import { PostgresInstallationSettingsStore } from "../src/database/postgres-installation-settings-store.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { createManifest } from "../src/recording/manifest.js";
import { SecretBox } from "../src/security/secret-box.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("Discord bot rotation in real PostgreSQL", () => {
  it("preserves same-app OAuth and atomically invalidates it for another application", async () => {
    const { database, cleanup } = await createIsolatedDatabase(connectionString);
    try {
      const box = new SecretBox(Buffer.alloc(32, 31).toString("base64url"));
      const settings = new PostgresInstallationSettingsStore({ database, secretBox: box });
      const connections = new PostgresInstallationDiscordConnectionStore(database, box);
      const approvals = new PostgresGuildOwnerApprovalStore(database);
      const sessions = new PostgresDashboardSessionStore(database);
      await settings.configureDiscordBot("application-1", "bot-token-1");
      await settings.setSecret("discord_client_secret", "client-secret-1");
      await connections.replaceConnection({
        accessToken: "access-token-1",
        discordUserId: "owner-a",
        discordUsername: "Owner A",
        expiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: "refresh-token-1",
      });
      await sessions.createSession({
        absoluteExpiresAt: "2099-01-01T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        tokenHash: "dashboard-session-1",
      });
      await connections.createState({
        browserBindingHash: "browser-hash",
        expiresAt: "2099-01-01T00:00:00.000Z",
        stateHash: "state-hash",
      });
      expect(await approvals.isConfirmed("guild-1", "owner-a")).toBe(true);
      const before = await settings.getBotConfigurationVersion();

      expect(await settings.rotateDiscordBot("application-1", "bot-token-2")).toBe("rotated");
      expect(await connections.getConnection()).toMatchObject({ discordUserId: "owner-a" });
      expect(await settings.getSecret("discord_client_secret")).toBe("client-secret-1");
      expect(await settings.getBotConfigurationVersion()).not.toBe(before);

      expect(await settings.rotateDiscordBot("application-2", "bot-token-3")).toBe("replaced");
      expect(await connections.getConnection()).toBeUndefined();
      expect(await settings.getSecret("discord_client_secret")).toBeUndefined();
      expect(await approvals.isConfirmed("guild-1", "owner-a")).toBe(true);
      const rows = await database.query(
        `SELECT
          (SELECT count(*)::integer FROM installation_oauth_states) AS states,
          (SELECT count(*)::integer FROM dashboard_sessions WHERE revoked_at IS NULL) AS sessions`,
      );
      expect(rows.rows[0]).toEqual({ sessions: 0, states: 0 });
    } finally {
      await cleanup();
    }
  });

  it("blocks token rotation during recording and application replacement during processing", async () => {
    const { database, cleanup } = await createIsolatedDatabase(connectionString);
    try {
      const box = new SecretBox(Buffer.alloc(32, 32).toString("base64url"));
      const settings = new PostgresInstallationSettingsStore({ database, secretBox: box });
      await settings.configureDiscordBot("application-1", "bot-token-1");
      const meeting = createManifest({
        guildId: "guild-rotation-test",
        meetingId: randomUUID(),
        notificationChannelId: "text-1",
        startedAt: "2026-09-29T12:00:00.000Z",
        voiceChannelId: "voice-1",
      });
      await new PostgresMeetingStore(database).save(meeting);
      await expect(settings.rotateDiscordBot("application-1", "bot-token-2")).rejects.toThrow(
        "active_recording",
      );
      await database.query("UPDATE meetings SET pipeline_status = 'queued' WHERE meeting_id = $1", [
        meeting.meetingId,
      ]);
      await expect(settings.rotateDiscordBot("application-2", "bot-token-2")).rejects.toThrow(
        "pending_meetings",
      );
      expect(await settings.getSecret("discord_bot_token")).toBe("bot-token-1");
    } finally {
      await cleanup();
    }
  });

  it("serializes a new recording against a token rotation", async () => {
    const { database, cleanup } = await createIsolatedDatabase(connectionString);
    try {
      const box = new SecretBox(Buffer.alloc(32, 33).toString("base64url"));
      const settings = new PostgresInstallationSettingsStore({ database, secretBox: box });
      await settings.configureDiscordBot("application-1", "bot-token-1");
      const version = await settings.getBotConfigurationVersion();
      const meeting = createManifest({
        guildId: "guild-concurrent-rotation",
        meetingId: randomUUID(),
        notificationChannelId: "text-1",
        startedAt: "2026-09-29T12:00:00.000Z",
        voiceChannelId: "voice-1",
      });

      const [recording, rotation] = await Promise.allSettled([
        new PostgresMeetingStore(database, version).save(meeting),
        settings.rotateDiscordBot("application-1", "bot-token-2"),
      ]);

      expect([recording.status, rotation.status].sort()).toEqual(["fulfilled", "rejected"]);
      const rows = await database.query(
        "SELECT count(*)::integer AS meetings FROM meetings WHERE meeting_id = $1",
        [meeting.meetingId],
      );
      if (recording.status === "fulfilled") {
        expect(rows.rows[0]?.meetings).toBe(1);
        await expect(settings.getSecret("discord_bot_token")).resolves.toBe("bot-token-1");
      } else {
        expect(rows.rows[0]?.meetings).toBe(0);
        await expect(settings.getSecret("discord_bot_token")).resolves.toBe("bot-token-2");
      }
    } finally {
      await cleanup();
    }
  });
});

async function createIsolatedDatabase(base: string | undefined) {
  if (base === undefined) throw new Error("POSTGRES_TEST_URL is required");
  const schema = `rotation_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: base });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const scopedUrl = new URL(base);
  scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
  const database = createPostgresDatabase(scopedUrl.toString());
  try {
    await database.initialize();
  } catch (error) {
    await database.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    database,
    cleanup: async () => {
      await database.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
