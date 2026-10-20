import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import {
  createPostgresDatabase,
  type PostgresExecutor,
} from "../src/database/postgres-database.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import {
  addParticipant,
  createManifest,
  markManifestCompleted,
} from "../src/recording/manifest.js";

const connectionString = process.env.POSTGRES_TEST_URL;
describe.skipIf(connectionString === undefined)("PostgreSQL write efficiency", () => {
  const schema = `query_efficiency_${randomUUID().replaceAll("-", "")}`;
  const admin = createPostgresDatabase(connectionString ?? "postgresql://invalid");
  const scoped = new URL(connectionString ?? "postgresql://invalid");
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const database = createPostgresDatabase(scoped.toString());
  const writes: number[] = [];
  const executor: PostgresExecutor = {
    query: async (sql, values) => {
      const result = await database.query(sql, values);
      if (
        sql.includes("UPDATE meeting_participants") ||
        sql.includes("INSERT INTO meeting_participants")
      ) {
        writes.push(result.rowCount ?? 0);
      }
      return result;
    },
  };
  const manifest = addParticipant(
    createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
      startedAt: "2026-10-20T12:00:00.000Z",
      storageMode: "postgres",
    }),
    { userId: "user-1", displayName: "Initial" },
  );

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await database.initialize();
    await new PostgresMeetingStore(database).save(manifest);
  });
  afterAll(async () => {
    await database.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  });

  it("refreshes changed profiles, including clearing avatars, without rewriting unchanged history", async () => {
    const store = new PostgresAnalyticsStore(executor);
    const profile = { displayName: "Initial", avatarUrl: null };
    await store.updateParticipantProfiles("guild-1", new Map([["user-1", profile]]));
    expect(writes.at(-1)).toBe(0);
    await store.updateParticipantProfiles(
      "guild-1",
      new Map([["user-1", { ...profile, avatarUrl: "https://example.com/avatar.png" }]]),
    );
    expect(writes.at(-1)).toBe(1);
    await store.updateParticipantProfiles("guild-1", new Map([["user-1", profile]]));
    expect(writes.at(-1)).toBe(1);
    await store.updateDisplayNames("guild-1", new Map([["user-1", "Initial"]]));
    expect(writes.at(-1)).toBe(0);
    await store.updateDisplayNames("another-guild", new Map([["user-1", "Private"]]));
    expect(writes.at(-1)).toBe(0);
  });

  it("persists participants idempotently while continuing to save every manifest", async () => {
    const store = new PostgresMeetingStore(executor);
    await store.save(manifest);
    expect(writes.at(-1)).toBe(0);
    const changed = { ...manifest, participants: [{ userId: "user-1", displayName: "Changed" }] };
    await store.save(changed);
    expect(writes.at(-1)).toBe(1);
    const loaded = await store.load(manifest.meetingId);
    expect(loaded.participants[0]?.displayName).toBe("Changed");
  });

  it("keeps exact per-currency meeting costs while sharing the aggregate scan", async () => {
    await new PostgresMeetingStore(database).save(
      markManifestCompleted({ ...manifest, meetingId: "money-1" }, "2026-10-20T13:00:00.000Z"),
    );
    await database.query(`INSERT INTO provider_cost_attempts (
      attempt_id, meeting_id, guild_id, phase, execution, provider, model, started_at, ended_at,
      outcome, financial_status, cost, currency
    ) SELECT item.id, 'money-1', 'guild-1', 'summary', 'api', 'openrouter', NULL,
      '2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z', 'success', 'confirmed', item.cost::numeric, item.currency
      FROM (VALUES ('usd-1', '0.123456789012345678', 'USD'), ('usd-2', '0.2', 'USD'), ('eur-1', '0.1', 'EUR')) item(id,cost,currency)`);
    let queries = 0;
    const store = new PostgresAnalyticsStore({
      query: async (sql, values) => {
        queries++;
        return database.query(sql, values);
      },
    });
    const detail = await store.getMeeting("guild-1", "money-1");
    expect(detail?.cost.confirmed).toEqual([
      { amount: "0.1", currency: "EUR" },
      { amount: "0.323456789012345678", currency: "USD" },
    ]);
    expect(detail?.cost.attemptCounts.confirmed).toBe(3);
    expect(detail?.cost.breakdown[0]?.confirmed).toEqual(detail?.cost.confirmed);
    expect(queries).toBe(3);
  });
});
