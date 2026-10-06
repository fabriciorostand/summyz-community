import { z } from "zod";

import type {
  CostAnalytics,
  CostAttemptCounts,
  DashboardAnalytics,
  DashboardAnalyticsOptions,
  DashboardCost,
} from "./postgres-analytics-store.js";
import type { PostgresExecutor } from "./postgres-database.js";

const dashboardPeriodCte = `WITH local_bounds AS (
  SELECT
    date_trunc('day', $3::timestamptz AT TIME ZONE $4) AS local_today,
    CASE $2 WHEN '30d' THEN 30 WHEN '90d' THEN 90 ELSE NULL END AS period_days
), bounds AS (
  SELECT
    CASE WHEN period_days IS NULL THEN '-infinity'::timestamptz
         ELSE (local_today - ((period_days - 1) * interval '1 day')) AT TIME ZONE $4 END AS current_from,
    (local_today + interval '1 day') AT TIME ZONE $4 AS current_to,
    CASE WHEN period_days IS NULL THEN NULL
         ELSE (local_today - ((period_days * 2 - 1) * interval '1 day')) AT TIME ZONE $4 END AS previous_from
  FROM local_bounds
)`;

const identifierSchema = z.string().min(1).max(128);
const dashboardAnalyticsOptionsSchema = z.object({
  now: z.iso.datetime().optional(),
  period: z.enum(["30d", "90d", "all"]),
  timeZone: z.string().trim().min(1).max(100),
});

export async function getDashboardAnalytics(
  database: PostgresExecutor,
  guildId: string,
  options: DashboardAnalyticsOptions,
): Promise<DashboardAnalytics> {
  const validatedGuildId = identifierSchema.parse(guildId);
  const validated = dashboardAnalyticsOptionsSchema.parse(options);
  const values = [
    validatedGuildId,
    validated.period,
    validated.now ?? new Date().toISOString(),
    validated.timeZone,
  ] as const;
  const [meetings, costTotals, costStages, speakers, series, tasks] = await Promise.all([
    database.query(
      `${dashboardPeriodCte}
       SELECT
        count(*) FILTER (
          WHERE pipeline_status IN ('completed', 'failed') AND started_at >= bounds.current_from
            AND started_at < bounds.current_to
        )::int AS total_calls,
        count(*) FILTER (
          WHERE pipeline_status IN ('completed', 'failed') AND bounds.previous_from IS NOT NULL
            AND started_at >= bounds.previous_from AND started_at < bounds.current_from
        )::int AS previous_calls,
        COALESCE(sum(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (
          WHERE pipeline_status = 'completed' AND started_at >= bounds.current_from
            AND started_at < bounds.current_to
        ), 0)::float8 AS total_duration_ms,
        COALESCE(avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (
          WHERE pipeline_status = 'completed' AND started_at >= bounds.current_from
            AND started_at < bounds.current_to
        ), 0)::float8 AS average_duration_ms
       FROM meetings CROSS JOIN bounds
       WHERE guild_id = $1`,
      values,
    ),
    database.query(
      `${dashboardPeriodCte}
       SELECT attempt.currency, sum(attempt.cost)::text AS amount
       FROM provider_cost_attempts attempt
       JOIN meetings meeting ON meeting.meeting_id = attempt.meeting_id
       CROSS JOIN bounds
       WHERE attempt.guild_id = $1 AND meeting.pipeline_status IN ('completed', 'failed')
         AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
         AND attempt.financial_status = 'confirmed'
       GROUP BY attempt.currency
       ORDER BY attempt.currency`,
      values,
    ),
    // Unconfirmed attempts come back with a null currency and amount: they only show the stage ran.
    database.query(
      `${dashboardPeriodCte}
       SELECT attempt.phase, attempt.execution,
              CASE WHEN attempt.financial_status = 'confirmed' THEN attempt.currency END AS currency,
              sum(attempt.cost) FILTER (WHERE attempt.financial_status = 'confirmed')::text AS amount
       FROM provider_cost_attempts attempt
       JOIN meetings meeting ON meeting.meeting_id = attempt.meeting_id
       CROSS JOIN bounds
       WHERE attempt.guild_id = $1 AND meeting.pipeline_status IN ('completed', 'failed')
         AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
       GROUP BY attempt.phase, attempt.execution,
                CASE WHEN attempt.financial_status = 'confirmed' THEN attempt.currency END
       ORDER BY attempt.phase, attempt.execution`,
      values,
    ),
    database.query(
      `${dashboardPeriodCte}, totals AS (
         SELECT participant.user_id, sum(participant.talk_time_ms)::bigint AS talk_time_ms
         FROM meeting_participants participant
         JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
         CROSS JOIN bounds
         WHERE participant.guild_id = $1 AND meeting.pipeline_status = 'completed'
           AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
           AND meeting.talk_time_available = true
         GROUP BY participant.user_id
       ), latest_names AS (
         SELECT DISTINCT ON (participant.user_id)
           participant.user_id, participant.display_name, participant.avatar_url
         FROM meeting_participants participant
         JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
         WHERE participant.guild_id = $1
         ORDER BY participant.user_id, meeting.started_at DESC
       )
       SELECT totals.user_id, latest_names.display_name, latest_names.avatar_url,
              totals.talk_time_ms
       FROM totals JOIN latest_names USING (user_id)
       ORDER BY totals.talk_time_ms DESC, totals.user_id
       LIMIT 5`,
      values,
    ),
    database.query(
      `${dashboardPeriodCte}
       SELECT
         date_trunc(CASE $2 WHEN '30d' THEN 'day' WHEN '90d' THEN 'week' ELSE 'month' END,
           meeting.started_at AT TIME ZONE $4)::date::text AS bucket_start,
         count(*) FILTER (WHERE meeting.pipeline_status = 'completed')::int AS completed,
         count(*) FILTER (WHERE meeting.pipeline_status = 'failed')::int AS failed
       FROM meetings meeting CROSS JOIN bounds
       WHERE meeting.guild_id = $1 AND meeting.pipeline_status IN ('completed', 'failed')
         AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
       GROUP BY bucket_start ORDER BY bucket_start`,
      values,
    ),
    database.query(
      `${dashboardPeriodCte}
       SELECT count(*)::int AS open_task_count
       FROM meeting_tasks task
       JOIN meetings meeting ON meeting.meeting_id = task.meeting_id
       CROSS JOIN bounds
       WHERE task.guild_id = $1 AND task.completed_at IS NULL
         AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to`,
      values,
    ),
  ]);
  const meetingRow = z
    .object({
      average_duration_ms: z.coerce.number().nonnegative(),
      previous_calls: z.coerce.number().int().nonnegative(),
      total_calls: z.coerce.number().int().nonnegative(),
      total_duration_ms: z.coerce.number().nonnegative(),
    })
    .parse(meetings.rows[0]);
  const previous = validated.period === "all" ? null : meetingRow.previous_calls;
  return {
    averageDurationMs: Math.round(meetingRow.average_duration_ms),
    calls: {
      current: meetingRow.total_calls,
      deltaPercentage:
        previous === null || previous === 0
          ? null
          : Math.round(((meetingRow.total_calls - previous) / previous) * 100),
      previous,
    },
    cost: mapDashboardCost(costTotals.rows, costStages.rows),
    openTaskCount: z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(tasks.rows[0]?.open_task_count ?? 0),
    period: validated.period,
    statusSeries: series.rows.map((row) => {
      const parsed = z
        .object({
          bucket_start: z.string(),
          completed: z.coerce.number().int().nonnegative(),
          failed: z.coerce.number().int().nonnegative(),
        })
        .parse(row);
      return {
        bucketStart: parsed.bucket_start,
        completed: parsed.completed,
        failed: parsed.failed,
      };
    }),
    topSpeakers: speakers.rows.map((row) => {
      const parsed = z
        .object({
          avatar_url: z.url().nullable(),
          display_name: z.string(),
          talk_time_ms: z.coerce.number(),
          user_id: z.string(),
        })
        .parse(row);
      return {
        avatarUrl: parsed.avatar_url,
        displayName: parsed.display_name,
        talkTimeMs: parsed.talk_time_ms,
        userId: parsed.user_id,
      };
    }),
    totalCalls: meetingRow.total_calls,
    totalDurationMs: Math.round(meetingRow.total_duration_ms),
  };
}

export async function getMeetingCostAnalytics(
  database: PostgresExecutor,
  guildId: string,
  meetingId: string,
): Promise<CostAnalytics> {
  const [totals, breakdown] = await Promise.all([
    database.query(
      `SELECT financial_status, currency,
              CASE WHEN financial_status = 'confirmed' THEN sum(cost)::text END AS amount,
              count(*)::int AS attempt_count
       FROM provider_cost_attempts
       WHERE guild_id = $1 AND meeting_id = $2
       GROUP BY financial_status, currency
       ORDER BY financial_status, currency`,
      [guildId, meetingId],
    ),
    database.query(
      `SELECT phase, provider, execution, financial_status, currency,
              CASE WHEN financial_status = 'confirmed' THEN sum(cost)::text END AS amount,
              count(*)::int AS attempt_count
       FROM provider_cost_attempts
       WHERE guild_id = $1 AND meeting_id = $2
       GROUP BY phase, provider, execution, financial_status, currency
       ORDER BY phase, provider, execution, financial_status, currency`,
      [guildId, meetingId],
    ),
  ]);
  return mapCostAnalytics(totals.rows, breakdown.rows);
}

const phases = ["transcription", "refinement", "summary"] as const;
const confirmedTotalRowSchema = z.object({ amount: z.string(), currency: z.string().length(3) });
const dashboardStageRowSchema = z.object({
  amount: z.string().nullable(),
  currency: z.string().length(3).nullable(),
  execution: z.enum(["api", "local"]),
  phase: z.enum(phases),
});

function mapDashboardCost(
  totalRows: readonly Record<string, unknown>[],
  stageRows: readonly Record<string, unknown>[],
): DashboardCost {
  const stages = phases.map((phase): DashboardCost["stages"][number] => ({
    confirmed: [],
    executions: [],
    phase,
  }));
  for (const input of stageRows) {
    const row = dashboardStageRowSchema.parse(input);
    const stage = stages[phases.indexOf(row.phase)];
    if (stage === undefined) continue;
    if (!stage.executions.includes(row.execution)) stage.executions.push(row.execution);
    if (row.amount !== null && row.currency !== null) {
      stage.confirmed.push({ amount: row.amount, currency: row.currency });
    }
  }
  return {
    confirmed: totalRows.map((row) => confirmedTotalRowSchema.parse(row)),
    stages,
  };
}

const costFinancialStatusSchema = z.enum([
  "confirmed",
  "pending",
  "unattributed",
  "not_applicable",
]);
export const costRowSchema = z.object({
  amount: z.string().nullable(),
  attempt_count: z.coerce.number().int().nonnegative(),
  currency: z.string().length(3).nullable(),
  financial_status: costFinancialStatusSchema,
});
const costBreakdownRowSchema = costRowSchema.extend({
  execution: z.enum(["api", "local"]),
  phase: z.enum(["transcription", "refinement", "summary"]),
  provider: z.string().min(1),
});

export function emptyAttemptCounts(): CostAttemptCounts {
  return { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 };
}

export function addAttemptCount(
  counts: CostAttemptCounts,
  status: z.infer<typeof costFinancialStatusSchema>,
  count: number,
): void {
  if (status === "not_applicable") counts.notApplicable += count;
  else counts[status] += count;
}

function mapCostAnalytics(
  totalRows: readonly Record<string, unknown>[],
  detailRows: readonly Record<string, unknown>[],
): CostAnalytics {
  const attemptCounts = emptyAttemptCounts();
  const confirmed: { amount: string; currency: string }[] = [];
  for (const input of totalRows) {
    addTotalCostRow(attemptCounts, confirmed, input);
  }

  type Breakdown = CostAnalytics["breakdown"][number];
  const byKey = new Map<string, Breakdown>();
  for (const input of detailRows) {
    addCostBreakdownRow(byKey, input);
  }
  return { attemptCounts, breakdown: [...byKey.values()], confirmed };
}

type ConfirmedCost = CostAnalytics["confirmed"][number];
type CostBreakdown = CostAnalytics["breakdown"][number];
type CostRow = z.infer<typeof costRowSchema>;
type CostBreakdownRow = z.infer<typeof costBreakdownRowSchema>;

function addTotalCostRow(
  attemptCounts: CostAttemptCounts,
  confirmed: ConfirmedCost[],
  input: Record<string, unknown>,
): void {
  const row = costRowSchema.parse(input);
  addAttemptCount(attemptCounts, row.financial_status, row.attempt_count);
  addConfirmedCost(confirmed, row);
}

function addCostBreakdownRow(
  byKey: Map<string, CostBreakdown>,
  input: Record<string, unknown>,
): void {
  const row = costBreakdownRowSchema.parse(input);
  const item = findOrCreateCostBreakdown(byKey, row);
  addAttemptCount(item.attemptCounts, row.financial_status, row.attempt_count);
  addConfirmedCost(item.confirmed, row);
}

function findOrCreateCostBreakdown(
  byKey: Map<string, CostBreakdown>,
  row: CostBreakdownRow,
): CostBreakdown {
  const key = `${row.phase}\0${row.provider}\0${row.execution}`;
  const existing = byKey.get(key);
  if (existing !== undefined) return existing;

  const created: CostBreakdown = {
    attemptCounts: emptyAttemptCounts(),
    confirmed: [],
    execution: row.execution,
    phase: row.phase,
    provider: row.provider,
  };
  byKey.set(key, created);
  return created;
}

export function addConfirmedCost(confirmed: ConfirmedCost[], row: CostRow): void {
  if (row.financial_status !== "confirmed") return;
  if (row.amount === null) return;
  if (row.currency === null) return;
  confirmed.push({ amount: row.amount, currency: row.currency });
}
