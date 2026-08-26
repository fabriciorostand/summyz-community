import { describe, expect, it, vi } from "vitest";

import { PostgresCostLedgerStore } from "../src/cost/postgres-cost-ledger-store.js";
import { createCostAttempt, finishCostAttempt } from "../src/cost/cost-ledger.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

function createDatabase(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
    rowCount: rows.length,
    rows,
  }));
  return { database: { query } satisfies PostgresExecutor, query };
}

describe("PostgresCostLedgerStore", () => {
  it("persiste uma tentativa com relacionamento ao servidor e à reunião", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresCostLedgerStore(database);
    const started = createCostAttempt({
      attemptId: "attempt-1",
      execution: "api",
      guildId: "guild-1",
      meetingId: "meeting-1",
      model: null,
      phase: "summary",
      provider: "openrouter",
      startedAt: "2026-08-24T11:31:00.000Z",
    });
    const completed = finishCostAttempt(started, {
      confirmationSource: "generation",
      cost: "0.000000123456",
      currency: "USD",
      endedAt: "2026-08-24T11:31:01.000Z",
      financialStatus: "confirmed",
      generationId: "gen-1",
      model: "model-effective",
      outcome: "failure",
    });

    await store.saveAttempt(completed);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO provider_cost_attempts[\s\S]+ON CONFLICT/),
      [
        "attempt-1",
        "meeting-1",
        "guild-1",
        "summary",
        "api",
        "openrouter",
        "model-effective",
        "2026-08-24T11:31:00.000Z",
        "2026-08-24T11:31:01.000Z",
        "failure",
        "confirmed",
        "0.000000123456",
        "USD",
        "gen-1",
        "generation",
      ],
    );
  });

  it("consulta somente a reunião pertencente ao servidor informado", async () => {
    const { database, query } = createDatabase([
      {
        attempt_id: null,
        completed_at: "2026-08-24T11:30:00.000Z",
        guild_id: "guild-1",
        meeting_id: "meeting-1",
        started_at: "2026-08-24T10:00:00.000Z",
      },
    ]);
    const store = new PostgresCostLedgerStore(database);

    await expect(store.getMeeting("guild-1", "meeting-1")).resolves.toMatchObject({
      attempts: [],
      meeting: { guildId: "guild-1", meetingId: "meeting-1" },
    });
    expect(query.mock.calls[0]?.[0]).toMatch(/m\.guild_id = \$1[\s\S]+m\.meeting_id = \$2/);
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", "meeting-1"]);
  });

  it("materializa tentativas retornadas pelo PostgreSQL", async () => {
    const { database } = createDatabase([
      {
        attempt_id: "attempt-1",
        attempt_started_at: new Date("2026-08-24T11:31:00.000Z"),
        completed_at: new Date("2026-08-24T11:30:00.000Z"),
        confirmation_source: "response",
        cost: "0.01",
        currency: "USD",
        ended_at: new Date("2026-08-24T11:31:01.000Z"),
        execution: "api",
        financial_status: "confirmed",
        generation_id: "gen-1",
        guild_id: "guild-1",
        meeting_id: "meeting-1",
        model: "model-effective",
        outcome: "success",
        phase: "summary",
        provider: "openrouter",
        started_at: new Date("2026-08-24T10:00:00.000Z"),
      },
    ]);
    const store = new PostgresCostLedgerStore(database);

    await expect(store.getMeeting("guild-1", "meeting-1")).resolves.toMatchObject({
      attempts: [expect.objectContaining({ attemptId: "attempt-1", cost: "0.01" })],
    });
  });

  it("usa o início da reunião no filtro por período", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresCostLedgerStore(database);
    await store.listMeetings("guild-1", {
      endedBefore: "2026-09-01T03:00:00.000Z",
      startedAtOrAfter: "2026-08-01T03:00:00.000Z",
    });

    expect(query.mock.calls[0]?.[0]).toMatch(
      /m\.guild_id = \$1[\s\S]+m\.started_at >= \$2[\s\S]+m\.started_at < \$3/,
    );
  });

  it("valida o manifesto mas usa a reunião persistida como catálogo", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresCostLedgerStore(database);
    const manifest = markManifestCompleted(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        startedAt: "2026-08-24T10:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      "2026-08-24T11:00:00.000Z",
    );

    await expect(store.saveMeeting(manifest)).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it("lista candidatos de reconciliação globalmente ou por servidor", async () => {
    const row = {
      attempt_id: "attempt-1",
      attempt_started_at: "2026-08-24T11:31:00.000Z",
      confirmation_source: null,
      cost: null,
      currency: null,
      ended_at: "2026-08-24T11:31:01.000Z",
      execution: "api",
      financial_status: "pending",
      generation_id: "gen-1",
      guild_id: "guild-1",
      meeting_id: "meeting-1",
      model: null,
      outcome: "failure",
      phase: "summary",
      provider: "openrouter",
    };
    const { database, query } = createDatabase([row]);
    const store = new PostgresCostLedgerStore(database);

    await expect(store.listReconciliationCandidates()).resolves.toHaveLength(1);
    await expect(store.listReconciliationCandidates("guild-1")).resolves.toHaveLength(1);
    expect(query.mock.calls[0]?.[1]).toEqual([]);
    expect(query.mock.calls[1]?.[1]).toEqual(["guild-1"]);
  });
});
