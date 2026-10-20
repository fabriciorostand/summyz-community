import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { z } from "zod";
import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import {
  createPostgresDatabase,
  type PostgresExecutor,
} from "../src/database/postgres-database.js";

const scenarios = [
  { name: "small", guilds: 5, meetings: 200, participants: 5, concurrency: 2 },
  { name: "intermediate", guilds: 20, meetings: 1_000, participants: 10, concurrency: 10 },
  { name: "stress", guilds: 50, meetings: 2_000, participants: 20, concurrency: 25 },
] as const;
type Scenario = (typeof scenarios)[number];
const timeZone = "America/Sao_Paulo";

async function seed(database: PostgresExecutor, scenario: Scenario): Promise<void> {
  await database.query(
    `INSERT INTO meetings (
    meeting_id, guild_id, voice_channel_id, notification_channel_id, recording_status,
    pipeline_status, persist_content, persist_audio, storage_mode, started_at, completed_at,
    voice_channel_name, talk_time_available
  ) SELECT 'meeting-' || guild || '-' || meeting, 'guild-' || guild, 'voice-1', 'text-1',
    'completed', CASE WHEN meeting % 10 = 0 THEN 'failed' ELSE 'completed' END,
    true, false, 'postgres',
    '2026-10-20T12:00:00Z'::timestamptz - (meeting % 120) * interval '1 day',
    '2026-10-20T13:00:00Z'::timestamptz - (meeting % 120) * interval '1 day', 'Synthetic', true
    FROM generate_series(1, $1::int) guild CROSS JOIN generate_series(1, $2::int) meeting`,
    [scenario.guilds, scenario.meetings],
  );
  await database.query(
    `INSERT INTO meeting_participants (
    meeting_id, guild_id, user_id, display_name, talk_time_ms, talk_percentage
  ) SELECT meeting_id, guild_id, 'user-' || participant, 'Synthetic ' || participant,
    1000, floor(100.0 / $1)::int FROM meetings
    CROSS JOIN generate_series(1, $1::int) participant`,
    [scenario.participants],
  );
  await database.query(`INSERT INTO provider_cost_attempts (
    attempt_id, meeting_id, guild_id, phase, execution, provider, model, started_at, ended_at,
    outcome, financial_status, cost, currency, confirmation_source
  ) SELECT meeting_id || '-' || phase, meeting_id, guild_id, phase, 'api', 'openrouter',
    'synthetic-model', started_at, completed_at, 'success', 'confirmed', 0.123456789012345678,
    'USD', 'response' FROM meetings
    CROSS JOIN unnest(ARRAY['transcription','refinement','summary']) phase`);
  await database.query("ANALYZE");
}

async function measure(database: PostgresExecutor, scenario: Scenario, connectionString: string) {
  const pool = new Pool({ connectionString, max: 5 });
  const results = [];
  try {
    await Promise.all(Array.from({ length: 5 }, () => pool.query("SELECT 1")));
    for (const name of [
      "history",
      "sameGuildHistory",
      "meetingDetail",
      "dashboard",
      "costs",
      "unchangedProfiles",
      "sameGuildProfiles",
      "changedProfiles",
    ] as const) {
      let queries = 0;
      let updatedRows = 0;
      let maxWaitingConnections = 0;
      const connectionWaits: number[] = [];
      const statements = new Map<string, readonly unknown[] | undefined>();
      const executor: PostgresExecutor = {
        query: async (sql, values) => {
          queries++;
          if (!statements.has(sql)) statements.set(sql, values);
          const queuedAt = performance.now();
          const pending = pool.connect();
          maxWaitingConnections = Math.max(maxWaitingConnections, pool.waitingCount);
          const client = await pending;
          connectionWaits.push(performance.now() - queuedAt);
          try {
            const result = await client.query<Record<string, unknown>>(
              sql,
              values === undefined ? undefined : [...values],
            );
            if (sql.trimStart().startsWith("UPDATE")) updatedRows += result.rowCount ?? 0;
            return { rowCount: result.rowCount, rows: result.rows };
          } finally {
            client.release();
          }
        },
      };
      const store = new PostgresAnalyticsStore(executor);
      const action = async (index: number, round = 0) => {
        const guildId = name.startsWith("sameGuild")
          ? "guild-1"
          : `guild-${1 + (index % scenario.guilds)}`;
        switch (name) {
          case "history":
          case "sameGuildHistory":
            return store.listMeetings(guildId, { page: 1, pageSize: 20, timeZone });
          case "dashboard":
            return store.getDashboard(guildId, {
              now: "2026-10-20T18:00:00.000Z",
              period: "30d",
              timeZone,
            });
          case "meetingDetail":
            return store.getMeeting(guildId, `meeting-${1 + (index % scenario.guilds)}-1`);
          case "costs":
            return store.getCostDetail(guildId, {
              dateFrom: "2026-06-01",
              dateTo: "2026-10-20",
              timeZone,
            });
          default:
            return store.updateParticipantProfiles(
              guildId,
              new Map([
                [
                  "user-1",
                  {
                    avatarUrl: null,
                    displayName:
                      name === "changedProfiles" && round % 2 === 1
                        ? "Changed synthetic"
                        : "Synthetic 1",
                  },
                ],
              ]),
            );
        }
      };
      await action(0);
      queries = 0;
      updatedRows = 0;
      connectionWaits.length = 0;
      maxWaitingConnections = 0;
      const durations: number[] = [];
      const started = performance.now();
      for (let round = 0; round < 3; round++) {
        await Promise.all(
          Array.from({ length: scenario.concurrency }, async (_, index) => {
            const before = performance.now();
            await action(index, round);
            durations.push(performance.now() - before);
          }),
        );
      }
      durations.sort((a, b) => a - b);
      connectionWaits.sort((a, b) => a - b);
      const elapsedMs = performance.now() - started;
      const plans = [];
      for (const [sql, values] of statements) {
        if (!/^(SELECT|WITH)/u.test(sql.trimStart())) continue;
        const explained = await database.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          values,
        );
        plans.push(explained.rows[0]?.["QUERY PLAN"]);
      }
      results.push({
        name,
        operations: durations.length,
        queries,
        updatedRows,
        medianMs: durations[Math.floor(durations.length / 2)],
        p95Ms: durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)],
        elapsedMs,
        p95PoolWaitMs:
          connectionWaits[
            Math.min(connectionWaits.length - 1, Math.ceil(connectionWaits.length * 0.95) - 1)
          ],
        maxWaitingConnections,
        plans,
      });
    }
    return results;
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const label = z.enum(["baseline", "optimized"]).parse(process.argv[2]);
  const reuse = process.argv[3] === "--reuse";
  const url = new URL(z.string().min(1).parse(process.env.DATABASE_BENCHMARK_URL));
  if (
    url.pathname !== "/summyz_query_benchmark" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    throw new Error("A dedicated loopback benchmark database is required");
  }
  const admin = createPostgresDatabase(url.toString());
  const report = [];
  try {
    for (const scenario of scenarios) {
      const schema = `query_benchmark_${scenario.name}`;
      if (label === "baseline" && !reuse) await admin.query(`CREATE SCHEMA ${schema}`);
      const scoped = new URL(url);
      scoped.searchParams.set("options", `-c search_path=${schema}`);
      const database = createPostgresDatabase(scoped.toString());
      try {
        if (label === "baseline" && !reuse) {
          await database.initialize();
          await seed(database, scenario);
        }
        const results = await measure(database, scenario, scoped.toString());
        report.push({ ...scenario, results });
        console.log(
          JSON.stringify({
            scenario: scenario.name,
            results: results.map(({ plans: _plans, ...metrics }) => metrics),
          }),
        );
      } finally {
        await database.close();
      }
    }
    await mkdir("artifacts/reports/database", { recursive: true });
    await writeFile(
      `artifacts/reports/database/${label}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
  } finally {
    await admin.close();
  }
}

main().catch((error: unknown) => {
  console.error("Database benchmark failed", {
    errorType: error instanceof Error ? error.name : typeof error,
  });
  process.exitCode = 1;
});
