import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCostAttempt, finishCostAttempt } from "../src/cost/cost-ledger.js";
import { PostgresCostLedgerStore } from "../src/cost/postgres-cost-ledger-store.js";
import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("PostgreSQL cost analytics", () => {
  const database = createPostgresDatabase(connectionString ?? "postgresql://invalid");
  const guildId = `guild-costs-${randomUUID()}`;
  const meetings = {
    cheap: randomUUID(),
    costly: randomUUID(),
    outside: randomUUID(),
    recording: randomUUID(),
  };

  async function saveMeeting(meetingId: string, startedAt: string, completedAt?: string) {
    const manifest = createManifest({
      guildId,
      meetingId,
      notificationChannelId: "text-costs",
      startedAt,
      storageMode: "postgres",
      voiceChannelId: "voice-costs",
      voiceChannelName: "Planejamento",
    });
    await new PostgresMeetingStore(database).save(
      completedAt === undefined ? manifest : markManifestCompleted(manifest, completedAt),
    );
  }

  async function saveAttempt(
    meetingId: string,
    input: {
      cost?: string;
      execution?: "api" | "local";
      outcome?: "failure" | "success";
      phase: "transcription" | "refinement" | "summary";
    },
  ) {
    const execution = input.execution ?? "api";
    const started = createCostAttempt({
      attemptId: randomUUID(),
      execution,
      guildId,
      meetingId,
      model: execution === "api" ? "openai/whisper-1" : "llama3.1:8b",
      phase: input.phase,
      provider: execution === "api" ? "openrouter" : "ollama",
      startedAt: "2026-09-10T12:01:00.000Z",
    });
    await new PostgresCostLedgerStore(database).saveAttempt(
      finishCostAttempt(started, {
        endedAt: "2026-09-10T12:02:00.000Z",
        outcome: input.outcome ?? "success",
        ...(execution === "local"
          ? { financialStatus: "not_applicable" }
          : input.cost === undefined
            ? { financialStatus: "pending" }
            : { cost: input.cost, currency: "USD", financialStatus: "confirmed" }),
      }),
    );
  }

  beforeAll(async () => {
    await database.initialize();
    // 00:30 on 1 September in São Paulo is still 31 August in UTC.
    await saveMeeting(meetings.costly, "2026-09-01T03:30:00.000Z", "2026-09-01T04:00:00.000Z");
    await saveMeeting(meetings.cheap, "2026-09-15T12:00:00.000Z", "2026-09-15T12:30:00.000Z");
    await saveMeeting(meetings.recording, "2026-09-20T12:00:00.000Z");
    await saveMeeting(meetings.outside, "2026-10-01T03:30:00.000Z", "2026-10-01T04:00:00.000Z");
    await saveAttempt(meetings.costly, { cost: "0.40", phase: "transcription" });
    await saveAttempt(meetings.costly, {
      cost: "0.05",
      outcome: "failure",
      phase: "transcription",
    });
    await saveAttempt(meetings.costly, { execution: "local", phase: "refinement" });
    await saveAttempt(meetings.cheap, { cost: "0.10", phase: "transcription" });
    await saveAttempt(meetings.cheap, { phase: "summary" });
    await saveAttempt(meetings.recording, { cost: "9.00", phase: "transcription" });
    await saveAttempt(meetings.outside, { cost: "9.00", phase: "transcription" });
  });

  afterAll(async () => {
    const ids = Object.values(meetings);
    await database.query("DELETE FROM provider_cost_attempts WHERE meeting_id = ANY($1::text[])", [
      ids,
    ]);
    await database.query("DELETE FROM meetings WHERE meeting_id = ANY($1::text[])", [ids]);
    await database.close();
  });

  it("counts only finished recordings that started inside the local calendar range", async () => {
    const detail = await new PostgresAnalyticsStore(database).getCostDetail(guildId, {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      timeZone: "America/Sao_Paulo",
    });

    expect(detail.meetingCount).toBe(2);
    expect(detail.attemptCounts).toEqual({
      confirmed: 3,
      notApplicable: 1,
      pending: 1,
      unattributed: 0,
    });
    expect(detail.confirmed).toEqual([{ amount: "0.55", currency: "USD" }]);
    expect(detail.stages.map((stage) => [stage.phase, stage.confirmed])).toEqual([
      ["transcription", [{ amount: "0.55", currency: "USD" }]],
      ["refinement", []],
      ["summary", []],
    ]);
    expect(detail.models).toEqual([
      {
        attemptCounts: { confirmed: 3, notApplicable: 0, pending: 0, unattributed: 0 },
        chargedFailures: { confirmed: [{ amount: "0.05", currency: "USD" }], count: 1 },
        confirmed: [{ amount: "0.55", currency: "USD" }],
        execution: "api",
        model: "openai/whisper-1",
        phase: "transcription",
        provider: "openrouter",
      },
      {
        attemptCounts: { confirmed: 0, notApplicable: 1, pending: 0, unattributed: 0 },
        chargedFailures: { confirmed: [], count: 0 },
        confirmed: [],
        execution: "local",
        model: "llama3.1:8b",
        phase: "refinement",
        provider: "ollama",
      },
      {
        attemptCounts: { confirmed: 0, notApplicable: 0, pending: 1, unattributed: 0 },
        chargedFailures: { confirmed: [], count: 0 },
        confirmed: [],
        execution: "api",
        model: "openai/whisper-1",
        phase: "summary",
        provider: "openrouter",
      },
    ]);
    expect(detail.topMeetings).toEqual([
      {
        confirmed: [{ amount: "0.45", currency: "USD" }],
        meetingId: meetings.costly,
        startedAt: "2026-09-01T03:30:00.000Z",
        voiceChannelName: "Planejamento",
      },
      {
        confirmed: [{ amount: "0.10", currency: "USD" }],
        meetingId: meetings.cheap,
        startedAt: "2026-09-15T12:00:00.000Z",
        voiceChannelName: "Planejamento",
      },
    ]);
  });

  it("splits the overview cost by stage only, telling local from unrun stages", async () => {
    await database.query(
      "UPDATE meetings SET pipeline_status = 'completed' WHERE meeting_id = ANY($1::text[])",
      [[meetings.costly, meetings.cheap, meetings.outside]],
    );

    const dashboard = await new PostgresAnalyticsStore(database).getDashboard(guildId, {
      now: "2026-09-30T15:00:00.000Z",
      period: "30d",
      timeZone: "America/Sao_Paulo",
    });

    expect(dashboard.cost).toEqual({
      confirmed: [{ amount: "0.55", currency: "USD" }],
      stages: [
        {
          confirmed: [{ amount: "0.55", currency: "USD" }],
          executions: ["api"],
          phase: "transcription",
        },
        { confirmed: [], executions: ["local"], phase: "refinement" },
        { confirmed: [], executions: ["api"], phase: "summary" },
      ],
    });
  });
});
