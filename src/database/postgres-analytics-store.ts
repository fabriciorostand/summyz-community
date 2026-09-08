import { z } from "zod";

import {
  createMeetingHistorySummary,
  type MeetingHistorySummary,
} from "../analytics/meeting-history-summary.js";
import { calculateTalkTime, type ParticipantTalkTime } from "../analytics/talk-time.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
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
const historyStateSchema = z.enum(["completed", "failed", "in_progress"]);
export type HistoryState = z.infer<typeof historyStateSchema>;

const participantRowSchema = z.object({
  avatar_url: z.string().url().nullable().optional(),
  display_name: z.string(),
  talk_percentage: z.coerce.number().int().min(0).max(100).nullable(),
  talk_time_ms: z.coerce.number().int().nonnegative().nullable(),
  user_id: z.string(),
});

export interface AnalyticsParticipant {
  avatarUrl: string | null;
  displayName: string;
  percentage: number | null;
  talkTimeMs: number | null;
  userId: string;
}

export interface DashboardAnalytics {
  averageDurationMs: number;
  calls: { current: number; deltaPercentage: number | null; previous: number | null };
  cost: CostAnalytics;
  openTaskCount: number;
  period: DashboardPeriod;
  statusSeries: { bucketStart: string; completed: number; failed: number }[];
  topSpeakers: {
    avatarUrl: string | null;
    displayName: string;
    talkTimeMs: number;
    userId: string;
  }[];
  totalCalls: number;
  totalDurationMs: number;
}

export type DashboardPeriod = "30d" | "90d" | "all";

export interface CostAttemptCounts {
  confirmed: number;
  notApplicable: number;
  pending: number;
  unattributed: number;
}

export interface CostAnalytics {
  attemptCounts: CostAttemptCounts;
  breakdown: {
    attemptCounts: CostAttemptCounts;
    confirmed: { amount: string; currency: string }[];
    execution: "api" | "local";
    phase: "transcription" | "refinement" | "summary" | "translation";
    provider: string;
  }[];
  confirmed: { amount: string; currency: string }[];
}

export interface DashboardAnalyticsOptions {
  now?: string;
  period: DashboardPeriod;
  timeZone: string;
}

export interface MeetingHistoryItem {
  completedAt: string | null;
  contentRetained: boolean;
  durationMs: number | null;
  failureCode: string | null;
  meetingId: string;
  participants: AnalyticsParticipant[] | null;
  pipelineStatus: string;
  startedAt: string;
  voiceChannelName: string | null;
}

export interface MeetingHistoryPage {
  items: MeetingHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface MeetingHistoryFilters {
  channelName?: string;
  contentRetained?: boolean;
  dateFrom?: string;
  dateTo?: string;
  meetingId?: string;
  page: number;
  pageSize: number;
  participantUserId?: string;
  state?: HistoryState;
  timeZone: string;
}

export interface MeetingHistoryDetail extends MeetingHistoryItem {
  aiProfile: { name: string; profileId: string } | null;
  audioRetained: boolean;
  cost: CostAnalytics;
  discordUrl: string | null;
  rawTranscript: string | null;
  summary: MeetingHistorySummary | null;
  transcript: string | null;
}

export class PostgresAnalyticsStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async getGuildCallCount(guildId: string): Promise<number> {
    const result = await this.#database.query(
      "SELECT count(*)::int AS call_count FROM meetings WHERE guild_id = $1",
      [identifierSchema.parse(guildId)],
    );
    return z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(result.rows[0]?.call_count ?? 0);
  }

  public async persistParticipation(
    manifest: RecordingManifest,
    transcription: TranscriptionState,
  ): Promise<void> {
    if (manifest.status !== "completed" || transcription.status !== "completed") {
      throw new Error("Talk time can only be persisted for a completed transcription");
    }
    const segments = new Map(manifest.segments.map((segment) => [segment.segmentId, segment]));
    const intervals = transcription.segments.flatMap((stateSegment) => {
      if (stateSegment.status !== "completed") return [];
      const segment = segments.get(stateSegment.segmentId);
      if (segment === undefined) throw new Error("The transcription references an unknown segment");
      const timelineOrigin = stateSegment.timelineStartedAtMs ?? segment.startedAtMs;
      return stateSegment.words.map((word) => ({
        endedAtMs: timelineOrigin + word.endedAtMs,
        startedAtMs: timelineOrigin + word.startedAtMs,
        userId: segment.userId,
      }));
    });
    const participants = calculateTalkTime(manifest.participants, intervals);
    await this.#database.query(
      `
WITH cleared AS (
  DELETE FROM meeting_participants WHERE meeting_id = $1
), inserted AS (
  INSERT INTO meeting_participants (
    meeting_id, guild_id, user_id, display_name, talk_time_ms, talk_percentage
  )
  SELECT $1, $2, item.user_id, item.display_name, item.talk_time_ms, item.talk_percentage
  FROM jsonb_to_recordset($3::jsonb) AS item(
    user_id text, display_name text, talk_time_ms bigint, talk_percentage smallint
  )
)
UPDATE meetings
SET talk_time_available = true, voice_channel_name = COALESCE($4, voice_channel_name), updated_at = now()
WHERE meeting_id = $1 AND guild_id = $2
`,
      [
        manifest.meetingId,
        manifest.guildId,
        JSON.stringify(participants.map(toDatabaseParticipant)),
        manifest.voiceChannelName ?? null,
      ],
    );
  }

  public async getDashboard(
    guildId: string,
    options: DashboardAnalyticsOptions = {
      period: "30d",
      timeZone: "America/Sao_Paulo",
    },
  ): Promise<DashboardAnalytics> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const validated = dashboardAnalyticsOptionsSchema.parse(options);
    const values = [
      validatedGuildId,
      validated.period,
      validated.now ?? new Date().toISOString(),
      validated.timeZone,
    ] as const;
    const [meetings, costTotals, costBreakdown, speakers, series, tasks] = await Promise.all([
      this.#database.query(
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
      this.#database.query(
        `${dashboardPeriodCte}
         SELECT attempt.financial_status, attempt.currency,
                CASE WHEN attempt.financial_status = 'confirmed' THEN sum(attempt.cost)::text END AS amount,
                count(*)::int AS attempt_count
         FROM provider_cost_attempts attempt
         JOIN meetings meeting ON meeting.meeting_id = attempt.meeting_id
         CROSS JOIN bounds
         WHERE attempt.guild_id = $1 AND meeting.pipeline_status IN ('completed', 'failed')
           AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
         GROUP BY attempt.financial_status, attempt.currency
         ORDER BY attempt.financial_status, attempt.currency`,
        values,
      ),
      this.#database.query(
        `${dashboardPeriodCte}
         SELECT attempt.phase, attempt.provider, attempt.execution, attempt.financial_status,
                attempt.currency,
                CASE WHEN attempt.financial_status = 'confirmed' THEN sum(attempt.cost)::text END AS amount,
                count(*)::int AS attempt_count
         FROM provider_cost_attempts attempt
         JOIN meetings meeting ON meeting.meeting_id = attempt.meeting_id
         CROSS JOIN bounds
         WHERE attempt.guild_id = $1 AND meeting.pipeline_status IN ('completed', 'failed')
           AND meeting.started_at >= bounds.current_from AND meeting.started_at < bounds.current_to
         GROUP BY attempt.phase, attempt.provider, attempt.execution,
                  attempt.financial_status, attempt.currency
         ORDER BY attempt.phase, attempt.provider, attempt.execution,
                  attempt.financial_status, attempt.currency`,
        values,
      ),
      this.#database.query(
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
      this.#database.query(
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
      this.#database.query(
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
      cost: mapCostAnalytics(costTotals.rows, costBreakdown.rows),
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

  public async listMeetings(
    guildId: string,
    filters: MeetingHistoryFilters,
  ): Promise<MeetingHistoryPage> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const validated = meetingHistoryFiltersSchema.parse(filters);
    const result = await this.#database.query(
      `
SELECT meeting.meeting_id, meeting.started_at, meeting.completed_at, meeting.pipeline_status,
       meeting.failure_code, meeting.voice_channel_name, meeting.talk_time_available,
       meeting.ai_profile_id, meeting.ai_profile_name,
       (content.meeting_id IS NOT NULL) AS content_retained,
       CASE WHEN meeting.completed_at IS NULL THEN NULL
            ELSE EXTRACT(EPOCH FROM (meeting.completed_at - meeting.started_at)) * 1000 END AS duration_ms,
       count(*) OVER()::int AS total
FROM meetings meeting
LEFT JOIN meeting_contents content ON content.meeting_id = meeting.meeting_id
WHERE meeting.guild_id = $1
  AND (
    ($2::text IS NOT NULL AND meeting.meeting_id = $2)
    OR
    ($2::text IS NULL
      AND ($3::date IS NULL OR meeting.started_at >= ($3::date::timestamp AT TIME ZONE $6))
      AND ($4::date IS NULL OR meeting.started_at < (($4::date + 1)::timestamp AT TIME ZONE $6))
      AND ($5::text IS NULL OR
        ($5 = 'completed' AND meeting.pipeline_status = 'completed') OR
        ($5 = 'failed' AND meeting.pipeline_status = 'failed') OR
        ($5 = 'in_progress' AND meeting.pipeline_status NOT IN ('completed', 'failed')))
      AND ($9::text IS NULL OR meeting.voice_channel_name ILIKE '%' || $9 || '%')
      AND ($10::boolean IS NULL OR (content.meeting_id IS NOT NULL) = $10)
      AND ($11::text IS NULL OR EXISTS (
        SELECT 1 FROM meeting_participants filtered_participant
        WHERE filtered_participant.meeting_id = meeting.meeting_id
          AND filtered_participant.user_id = $11
      ))
    )
  )
ORDER BY meeting.started_at DESC, meeting.meeting_id
LIMIT $7 OFFSET $8
`,
      meetingHistoryQueryValues(validatedGuildId, validated),
    );
    const items = await Promise.all(
      result.rows.map(async (row) => this.#mapMeetingRow(row, validatedGuildId)),
    );
    return {
      items,
      page: validated.page,
      pageSize: validated.pageSize,
      total: parseMeetingHistoryTotal(result.rows[0]),
    };
  }

  public async getMeeting(
    guildId: string,
    meetingId: string,
  ): Promise<MeetingHistoryDetail | undefined> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const validatedMeetingId = identifierSchema.parse(meetingId);
    const result = await this.#database.query(
      `SELECT meeting.meeting_id, meeting.started_at, meeting.completed_at, meeting.pipeline_status,
              meeting.failure_code, meeting.voice_channel_name, meeting.talk_time_available,
              meeting.ai_profile_id, meeting.ai_profile_name,
              meeting.publication_thread_id, meeting.publication_root_message_id,
              EXISTS(
                SELECT 1 FROM meeting_audio_segments audio
                WHERE audio.meeting_id = meeting.meeting_id
              ) AS audio_retained,
              (content.meeting_id IS NOT NULL) AS content_retained,
              CASE WHEN meeting.completed_at IS NULL THEN NULL
                   ELSE EXTRACT(EPOCH FROM (meeting.completed_at - meeting.started_at)) * 1000 END AS duration_ms,
              content.raw_transcript, content.transcript, content.summary,
              content.meeting_manifest
       FROM meetings meeting
       LEFT JOIN meeting_contents content ON content.meeting_id = meeting.meeting_id
       WHERE meeting.guild_id = $1 AND meeting.meeting_id = $2`,
      [validatedGuildId, validatedMeetingId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    const parsedTechnical = z
      .object({
        ai_profile_id: z.string().nullable(),
        ai_profile_name: z.string().nullable(),
        audio_retained: z.boolean(),
        publication_root_message_id: z.string().nullable(),
        publication_thread_id: z.string().nullable(),
      })
      .parse(row);
    const meeting = await this.#mapMeetingRow(row, validatedGuildId);
    const cost = await this.#getMeetingCost(validatedGuildId, validatedMeetingId);
    return {
      ...meeting,
      aiProfile:
        parsedTechnical.ai_profile_id === null || parsedTechnical.ai_profile_name === null
          ? null
          : { name: parsedTechnical.ai_profile_name, profileId: parsedTechnical.ai_profile_id },
      audioRetained: parsedTechnical.audio_retained,
      cost,
      discordUrl:
        parsedTechnical.publication_thread_id === null
          ? null
          : `https://discord.com/channels/${validatedGuildId}/${parsedTechnical.publication_thread_id}${
              parsedTechnical.publication_root_message_id === null
                ? ""
                : `/${parsedTechnical.publication_root_message_id}`
            }`,
      rawTranscript: z
        .string()
        .nullable()
        .parse(row.raw_transcript ?? null),
      summary:
        row.summary === null || row.summary === undefined
          ? null
          : createMeetingHistorySummary(row.summary, row.meeting_manifest),
      transcript: z
        .string()
        .nullable()
        .parse(row.transcript ?? null),
    };
  }

  async #getMeetingCost(guildId: string, meetingId: string): Promise<CostAnalytics> {
    const [totals, breakdown] = await Promise.all([
      this.#database.query(
        `SELECT financial_status, currency,
                CASE WHEN financial_status = 'confirmed' THEN sum(cost)::text END AS amount,
                count(*)::int AS attempt_count
         FROM provider_cost_attempts
         WHERE guild_id = $1 AND meeting_id = $2
         GROUP BY financial_status, currency
         ORDER BY financial_status, currency`,
        [guildId, meetingId],
      ),
      this.#database.query(
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

  public async updateDisplayNames(
    guildId: string,
    names: ReadonlyMap<string, string>,
  ): Promise<void> {
    const validatedGuildId = identifierSchema.parse(guildId);
    if (names.size === 0) return;
    await this.#database.query(
      `UPDATE meeting_participants participant
       SET display_name = item.display_name
       FROM jsonb_to_recordset($2::jsonb) AS item(user_id text, display_name text)
       WHERE participant.guild_id = $1 AND participant.user_id = item.user_id`,
      [
        validatedGuildId,
        JSON.stringify(
          [...names].map(([userId, displayName]) => ({
            display_name: displayName,
            user_id: userId,
          })),
        ),
      ],
    );
  }

  public async updateParticipantProfiles(
    guildId: string,
    profiles: ReadonlyMap<string, { avatarUrl: string | null; displayName: string }>,
  ): Promise<void> {
    const validatedGuildId = identifierSchema.parse(guildId);
    if (profiles.size === 0) return;
    await this.#database.query(
      `UPDATE meeting_participants participant
       SET display_name = item.display_name, avatar_url = item.avatar_url
       FROM jsonb_to_recordset($2::jsonb) AS item(
         user_id text, display_name text, avatar_url text
       )
       WHERE participant.guild_id = $1 AND participant.user_id = item.user_id`,
      [
        validatedGuildId,
        JSON.stringify(
          [...profiles].map(([userId, profile]) => ({
            avatar_url: profile.avatarUrl,
            display_name: profile.displayName,
            user_id: userId,
          })),
        ),
      ],
    );
  }

  async #mapMeetingRow(row: Record<string, unknown>, guildId: string): Promise<MeetingHistoryItem> {
    const parsed = z
      .object({
        completed_at: z.coerce.date().nullable(),
        ai_profile_id: z.string().nullable().optional(),
        ai_profile_name: z.string().nullable().optional(),
        content_retained: z.boolean(),
        duration_ms: z.coerce.number().nullable(),
        failure_code: z.string().nullable(),
        meeting_id: z.string(),
        pipeline_status: z.string(),
        started_at: z.coerce.date(),
        talk_time_available: z.boolean(),
        voice_channel_name: z.string().nullable(),
      })
      .parse(row);
    return {
      completedAt: parsed.completed_at?.toISOString() ?? null,
      contentRetained: parsed.content_retained,
      durationMs: parsed.duration_ms === null ? null : Math.round(parsed.duration_ms),
      failureCode: parsed.failure_code,
      meetingId: parsed.meeting_id,
      participants: await this.#listParticipants(guildId, parsed.meeting_id).then((participants) =>
        participants.length === 0 ? null : participants,
      ),
      pipelineStatus: parsed.pipeline_status,
      startedAt: parsed.started_at.toISOString(),
      voiceChannelName: parsed.voice_channel_name,
    };
  }

  async #listParticipants(guildId: string, meetingId: string): Promise<AnalyticsParticipant[]> {
    const result = await this.#database.query(
      `SELECT user_id, display_name, avatar_url, talk_time_ms, talk_percentage
       FROM meeting_participants WHERE guild_id = $1 AND meeting_id = $2
       ORDER BY talk_percentage DESC, user_id`,
      [guildId, meetingId],
    );
    return result.rows.map((row) => {
      const parsed = participantRowSchema.parse(row);
      return {
        avatarUrl: parsed.avatar_url ?? null,
        displayName: parsed.display_name,
        percentage: parsed.talk_percentage,
        talkTimeMs: parsed.talk_time_ms,
        userId: parsed.user_id,
      };
    });
  }
}

const meetingHistoryFiltersSchema = z.object({
  channelName: z.string().trim().min(1).max(100).optional(),
  contentRetained: z.boolean().optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  meetingId: identifierSchema.optional(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
  participantUserId: identifierSchema.optional(),
  state: historyStateSchema.optional(),
  timeZone: z.string().min(1).max(100),
});

type ValidatedMeetingHistoryFilters = z.infer<typeof meetingHistoryFiltersSchema>;

function meetingHistoryQueryValues(
  guildId: string,
  filters: ValidatedMeetingHistoryFilters,
): unknown[] {
  return [
    guildId,
    filters.meetingId ?? null,
    filters.dateFrom ?? null,
    filters.dateTo ?? null,
    filters.state ?? null,
    filters.timeZone,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
    filters.channelName ?? null,
    filters.contentRetained ?? null,
    filters.participantUserId ?? null,
  ];
}

const dashboardAnalyticsOptionsSchema = z.object({
  now: z.iso.datetime().optional(),
  period: z.enum(["30d", "90d", "all"]),
  timeZone: z.string().trim().min(1).max(100),
});

const costFinancialStatusSchema = z.enum([
  "confirmed",
  "pending",
  "unattributed",
  "not_applicable",
]);
const costRowSchema = z.object({
  amount: z.string().nullable(),
  attempt_count: z.coerce.number().int().nonnegative(),
  currency: z.string().length(3).nullable(),
  financial_status: costFinancialStatusSchema,
});
const costBreakdownRowSchema = costRowSchema.extend({
  execution: z.enum(["api", "local"]),
  phase: z.enum(["transcription", "refinement", "summary", "translation"]),
  provider: z.string().min(1),
});

function emptyAttemptCounts(): CostAttemptCounts {
  return { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 };
}

function addAttemptCount(
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
    const row = costRowSchema.parse(input);
    addAttemptCount(attemptCounts, row.financial_status, row.attempt_count);
    if (row.financial_status === "confirmed" && row.amount !== null && row.currency !== null) {
      confirmed.push({ amount: row.amount, currency: row.currency });
    }
  }

  type Breakdown = CostAnalytics["breakdown"][number];
  const byKey = new Map<string, Breakdown>();
  for (const input of detailRows) {
    const row = costBreakdownRowSchema.parse(input);
    const key = `${row.phase}\0${row.provider}\0${row.execution}`;
    const item = byKey.get(key) ?? {
      attemptCounts: emptyAttemptCounts(),
      confirmed: [],
      execution: row.execution,
      phase: row.phase,
      provider: row.provider,
    };
    addAttemptCount(item.attemptCounts, row.financial_status, row.attempt_count);
    if (row.financial_status === "confirmed" && row.amount !== null && row.currency !== null) {
      item.confirmed.push({ amount: row.amount, currency: row.currency });
    }
    byKey.set(key, item);
  }
  return { attemptCounts, breakdown: [...byKey.values()], confirmed };
}

function parseMeetingHistoryTotal(row: Record<string, unknown> | undefined): number {
  return z.coerce.number().int().nonnegative().catch(0).parse(row?.total);
}

function toDatabaseParticipant(participant: ParticipantTalkTime) {
  return {
    display_name: participant.displayName,
    talk_percentage: participant.percentage,
    talk_time_ms: participant.talkTimeMs,
    user_id: participant.userId,
  };
}
