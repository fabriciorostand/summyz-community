import { z } from "zod";

import {
  addAttemptCount,
  addConfirmedCost,
  costRowSchema,
  emptyAttemptCounts,
} from "./postgres-analytics-dashboard.js";
import type { CostDetail, CostDetailOptions } from "./postgres-analytics-store.js";
import type { PostgresExecutor } from "./postgres-database.js";

const phases = ["transcription", "refinement", "summary"] as const;

const costDetailOptionsSchema = z
  .object({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    timeZone: z.string().trim().min(1).max(100),
  })
  .refine((options) => options.dateFrom <= options.dateTo, { message: "invalid_period" });

/**
 * Meetings that started inside the calendar range and have stopped recording. Processing may
 * still add attempts to them.
 */
const periodMeetingsCte = `WITH period_meetings AS (
  SELECT meeting.meeting_id, meeting.started_at, meeting.voice_channel_name
  FROM meetings meeting
  WHERE meeting.guild_id = $1 AND meeting.completed_at IS NOT NULL
    AND meeting.started_at >= ($2::date::timestamp AT TIME ZONE $4)
    AND meeting.started_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
)`;

const phaseOrder = "array_position(ARRAY['transcription', 'refinement', 'summary'], attempt.phase)";

const phaseSchema = z.enum(phases);
const stageRowSchema = costRowSchema.extend({ phase: phaseSchema });
const modelRowSchema = costRowSchema.extend({
  charged_failure_amount: z.string().nullable(),
  charged_failure_count: z.coerce.number().int().nonnegative(),
  execution: z.enum(["api", "local"]),
  model: z.string().nullable(),
  phase: phaseSchema,
  provider: z.string().min(1),
});
const meetingRowSchema = z.object({
  amount: z.string(),
  currency: z.string().length(3),
  meeting_id: z.string(),
  started_at: z.coerce.date(),
  voice_channel_name: z.string().nullable(),
});

type Model = CostDetail["models"][number];
type Stage = CostDetail["stages"][number];
type TopMeeting = CostDetail["topMeetings"][number];

export async function getCostDetail(
  database: PostgresExecutor,
  guildId: string,
  options: CostDetailOptions,
): Promise<CostDetail> {
  const validated = costDetailOptionsSchema.parse(options);
  const values = [guildId, validated.dateFrom, validated.dateTo, validated.timeZone] as const;
  const [totals, stages, models, meetings, meetingCount] = await Promise.all([
    database.query(
      `${periodMeetingsCte}
       SELECT attempt.financial_status, attempt.currency,
              CASE WHEN attempt.financial_status = 'confirmed' THEN sum(attempt.cost)::text END AS amount,
              count(*)::int AS attempt_count
       FROM provider_cost_attempts attempt
       JOIN period_meetings USING (meeting_id)
       WHERE attempt.guild_id = $1
       GROUP BY attempt.financial_status, attempt.currency
       ORDER BY attempt.financial_status, attempt.currency`,
      values,
    ),
    database.query(
      `${periodMeetingsCte}
       SELECT attempt.phase, attempt.financial_status, attempt.currency,
              CASE WHEN attempt.financial_status = 'confirmed' THEN sum(attempt.cost)::text END AS amount,
              count(*)::int AS attempt_count
       FROM provider_cost_attempts attempt
       JOIN period_meetings USING (meeting_id)
       WHERE attempt.guild_id = $1
       GROUP BY attempt.phase, attempt.financial_status, attempt.currency
       ORDER BY ${phaseOrder}, attempt.financial_status, attempt.currency`,
      values,
    ),
    database.query(
      `${periodMeetingsCte}
       SELECT attempt.phase, attempt.execution, attempt.provider, attempt.model,
              attempt.financial_status, attempt.currency,
              CASE WHEN attempt.financial_status = 'confirmed' THEN sum(attempt.cost)::text END AS amount,
              count(*)::int AS attempt_count,
              count(*) FILTER (
                WHERE attempt.outcome = 'failure' AND attempt.financial_status = 'confirmed'
                  AND attempt.cost > 0
              )::int AS charged_failure_count,
              CASE WHEN attempt.financial_status = 'confirmed' THEN (sum(attempt.cost) FILTER (
                WHERE attempt.outcome = 'failure' AND attempt.cost > 0
              ))::text END AS charged_failure_amount
       FROM provider_cost_attempts attempt
       JOIN period_meetings USING (meeting_id)
       WHERE attempt.guild_id = $1
       GROUP BY attempt.phase, attempt.execution, attempt.provider, attempt.model,
                attempt.financial_status, attempt.currency
       ORDER BY ${phaseOrder}, attempt.execution, attempt.provider, attempt.model NULLS LAST,
                attempt.financial_status, attempt.currency`,
      values,
    ),
    // Confirmed charges come from OpenRouter in USD, so one sum per meeting orders the ranking;
    // the amounts themselves stay split by currency.
    database.query(
      `${periodMeetingsCte}, ranked AS (
         SELECT attempt.meeting_id, sum(attempt.cost) AS ranking_total
         FROM provider_cost_attempts attempt
         JOIN period_meetings USING (meeting_id)
         WHERE attempt.guild_id = $1 AND attempt.financial_status = 'confirmed' AND attempt.cost > 0
         GROUP BY attempt.meeting_id
         ORDER BY ranking_total DESC, attempt.meeting_id
         LIMIT 5
       )
       SELECT meeting.meeting_id, meeting.started_at, meeting.voice_channel_name,
              attempt.currency, sum(attempt.cost)::text AS amount
       FROM ranked
       JOIN period_meetings meeting ON meeting.meeting_id = ranked.meeting_id
       JOIN provider_cost_attempts attempt ON attempt.meeting_id = ranked.meeting_id
       WHERE attempt.guild_id = $1 AND attempt.financial_status = 'confirmed' AND attempt.cost > 0
       GROUP BY meeting.meeting_id, meeting.started_at, meeting.voice_channel_name,
                attempt.currency, ranked.ranking_total
       ORDER BY ranked.ranking_total DESC, meeting.meeting_id, attempt.currency`,
      values,
    ),
    database.query(
      `${periodMeetingsCte}
       SELECT count(*)::int AS meeting_count FROM period_meetings`,
      values,
    ),
  ]);

  const attemptCounts = emptyAttemptCounts();
  const confirmed: CostDetail["confirmed"] = [];
  for (const input of totals.rows) {
    const row = costRowSchema.parse(input);
    addAttemptCount(attemptCounts, row.financial_status, row.attempt_count);
    addConfirmedCost(confirmed, row);
  }
  return {
    attemptCounts,
    confirmed,
    meetingCount: z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(meetingCount.rows[0]?.meeting_count ?? 0),
    models: mapModels(models.rows),
    stages: mapStages(stages.rows),
    topMeetings: mapTopMeetings(meetings.rows),
  };
}

/** Every stage is returned in pipeline order, so the page can show stages that never ran. */
function mapStages(rows: readonly Record<string, unknown>[]): Stage[] {
  const stages = phases.map(
    (phase): Stage => ({ attemptCounts: emptyAttemptCounts(), confirmed: [], phase }),
  );
  for (const input of rows) {
    const row = stageRowSchema.parse(input);
    const stage = stages[phases.indexOf(row.phase)];
    if (stage === undefined) continue;
    addAttemptCount(stage.attemptCounts, row.financial_status, row.attempt_count);
    addConfirmedCost(stage.confirmed, row);
  }
  return stages;
}

function mapModels(rows: readonly Record<string, unknown>[]): Model[] {
  const byKey = new Map<string, Model>();
  for (const input of rows) {
    const row = modelRowSchema.parse(input);
    const key = [row.phase, row.execution, row.provider, row.model ?? ""].join("\0");
    let model = byKey.get(key);
    if (model === undefined) {
      model = {
        attemptCounts: emptyAttemptCounts(),
        chargedFailures: { confirmed: [], count: 0 },
        confirmed: [],
        execution: row.execution,
        model: row.model,
        phase: row.phase,
        provider: row.provider,
      };
      byKey.set(key, model);
    }
    addAttemptCount(model.attemptCounts, row.financial_status, row.attempt_count);
    addConfirmedCost(model.confirmed, row);
    model.chargedFailures.count += row.charged_failure_count;
    addConfirmedCost(model.chargedFailures.confirmed, {
      ...row,
      amount: row.charged_failure_amount,
    });
  }
  return [...byKey.values()];
}

function mapTopMeetings(rows: readonly Record<string, unknown>[]): TopMeeting[] {
  const byId = new Map<string, TopMeeting>();
  for (const input of rows) {
    const row = meetingRowSchema.parse(input);
    const amount = { amount: row.amount, currency: row.currency };
    const existing = byId.get(row.meeting_id);
    if (existing === undefined) {
      byId.set(row.meeting_id, {
        confirmed: [amount],
        meetingId: row.meeting_id,
        startedAt: row.started_at.toISOString(),
        voiceChannelName: row.voice_channel_name,
      });
    } else {
      existing.confirmed.push(amount);
    }
  }
  return [...byId.values()];
}
