import { describe, expect, it, vi } from "vitest";

import { PostgresAnalyticsStore } from "../src/database/postgres-analytics-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

function storeWith(responses: { rows: Record<string, unknown>[] }[]) {
  const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
    rowCount: 1,
    ...(responses.shift() ?? { rows: [] }),
  }));
  return { query, store: new PostgresAnalyticsStore({ query } satisfies PostgresExecutor) };
}

const range = { dateFrom: "2026-09-01", dateTo: "2026-09-30", timeZone: "America/Sao_Paulo" };

describe("PostgresAnalyticsStore cost detail", () => {
  it("groups exact costs by stage, model and charged failures with the five costliest meetings", async () => {
    const { query, store } = storeWith([
      {
        rows: [
          { amount: "0.420000", attempt_count: 3, currency: "USD", financial_status: "confirmed" },
          { amount: null, attempt_count: 1, currency: null, financial_status: "pending" },
          { amount: null, attempt_count: 2, currency: null, financial_status: "not_applicable" },
        ],
      },
      {
        rows: [
          {
            amount: "0.400000",
            attempt_count: 2,
            currency: "USD",
            financial_status: "confirmed",
            phase: "transcription",
          },
          {
            amount: null,
            attempt_count: 1,
            currency: null,
            financial_status: "pending",
            phase: "transcription",
          },
          {
            amount: null,
            attempt_count: 2,
            currency: null,
            financial_status: "not_applicable",
            phase: "refinement",
          },
          {
            amount: "0.020000",
            attempt_count: 1,
            currency: "USD",
            financial_status: "confirmed",
            phase: "summary",
          },
        ],
      },
      {
        rows: [
          {
            amount: "0.400000",
            attempt_count: 2,
            charged_failure_amount: "0.050000",
            charged_failure_count: 1,
            currency: "USD",
            execution: "api",
            financial_status: "confirmed",
            model: "openai/whisper-1",
            phase: "transcription",
            provider: "openrouter",
          },
          {
            amount: null,
            attempt_count: 1,
            charged_failure_amount: null,
            charged_failure_count: 0,
            currency: null,
            execution: "api",
            financial_status: "pending",
            model: "openai/whisper-1",
            phase: "transcription",
            provider: "openrouter",
          },
          {
            amount: null,
            attempt_count: 2,
            charged_failure_amount: null,
            charged_failure_count: 0,
            currency: null,
            execution: "local",
            financial_status: "not_applicable",
            model: null,
            phase: "refinement",
            provider: "ollama",
          },
        ],
      },
      {
        rows: [
          {
            amount: "0.300000",
            currency: "USD",
            meeting_id: "meeting-1",
            started_at: new Date("2026-09-10T13:00:00.000Z"),
            voice_channel_name: "Planejamento",
          },
          {
            amount: "0.120000",
            currency: "USD",
            meeting_id: "meeting-2",
            started_at: "2026-09-12T13:00:00.000Z",
            voice_channel_name: null,
          },
        ],
      },
      { rows: [{ meeting_count: 4 }] },
    ]);

    await expect(store.getCostDetail("guild-1", range)).resolves.toEqual({
      attemptCounts: { confirmed: 3, notApplicable: 2, pending: 1, unattributed: 0 },
      confirmed: [{ amount: "0.420000", currency: "USD" }],
      meetingCount: 4,
      models: [
        {
          attemptCounts: { confirmed: 2, notApplicable: 0, pending: 1, unattributed: 0 },
          chargedFailures: { confirmed: [{ amount: "0.050000", currency: "USD" }], count: 1 },
          confirmed: [{ amount: "0.400000", currency: "USD" }],
          execution: "api",
          model: "openai/whisper-1",
          phase: "transcription",
          provider: "openrouter",
        },
        {
          attemptCounts: { confirmed: 0, notApplicable: 2, pending: 0, unattributed: 0 },
          chargedFailures: { confirmed: [], count: 0 },
          confirmed: [],
          execution: "local",
          model: null,
          phase: "refinement",
          provider: "ollama",
        },
      ],
      stages: [
        {
          attemptCounts: { confirmed: 2, notApplicable: 0, pending: 1, unattributed: 0 },
          confirmed: [{ amount: "0.400000", currency: "USD" }],
          phase: "transcription",
        },
        {
          attemptCounts: { confirmed: 0, notApplicable: 2, pending: 0, unattributed: 0 },
          confirmed: [],
          phase: "refinement",
        },
        {
          attemptCounts: { confirmed: 1, notApplicable: 0, pending: 0, unattributed: 0 },
          confirmed: [{ amount: "0.020000", currency: "USD" }],
          phase: "summary",
        },
      ],
      topMeetings: [
        {
          confirmed: [{ amount: "0.300000", currency: "USD" }],
          meetingId: "meeting-1",
          startedAt: "2026-09-10T13:00:00.000Z",
          voiceChannelName: "Planejamento",
        },
        {
          confirmed: [{ amount: "0.120000", currency: "USD" }],
          meetingId: "meeting-2",
          startedAt: "2026-09-12T13:00:00.000Z",
          voiceChannelName: null,
        },
      ],
    });
    for (const [text, values] of query.mock.calls) {
      // Meetings that started in the range and stopped recording.
      expect(text).toContain("meeting.completed_at IS NOT NULL");
      expect(values).toEqual(["guild-1", "2026-09-01", "2026-09-30", "America/Sao_Paulo"]);
    }
    expect(query.mock.calls[2]?.[0]).toContain("attempt.outcome = 'failure'");
    expect(query.mock.calls[3]?.[0]).toContain("LIMIT 5");
  });

  it("returns every stage in pipeline order even without recorded attempts", async () => {
    const { store } = storeWith([]);

    const detail = await store.getCostDetail("guild-1", range);

    expect(detail.stages.map((stage) => stage.phase)).toEqual([
      "transcription",
      "refinement",
      "summary",
    ]);
    expect(detail).toMatchObject({ meetingCount: 0, models: [], topMeetings: [] });
  });

  it("merges a meeting charged in more than one currency into a single entry", async () => {
    const { store } = storeWith([
      { rows: [] },
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            amount: "0.3",
            currency: "USD",
            meeting_id: "meeting-1",
            started_at: "2026-09-10T13:00:00.000Z",
            voice_channel_name: "Planejamento",
          },
          {
            amount: "0.1",
            currency: "EUR",
            meeting_id: "meeting-1",
            started_at: "2026-09-10T13:00:00.000Z",
            voice_channel_name: "Planejamento",
          },
        ],
      },
    ]);

    const detail = await store.getCostDetail("guild-1", range);

    expect(detail.topMeetings).toEqual([
      expect.objectContaining({
        confirmed: [
          { amount: "0.3", currency: "USD" },
          { amount: "0.1", currency: "EUR" },
        ],
        meetingId: "meeting-1",
      }),
    ]);
  });

  it.each([
    { dateFrom: "2026-09-30", dateTo: "2026-09-01" },
    { dateFrom: "2026-02-30", dateTo: "2026-03-01" },
    { dateFrom: "01/09/2026", dateTo: "2026-09-30" },
  ])("rejects the invalid range $dateFrom..$dateTo before querying", async (dates) => {
    const { query, store } = storeWith([]);

    await expect(
      store.getCostDetail("guild-1", { ...dates, timeZone: "America/Sao_Paulo" }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
