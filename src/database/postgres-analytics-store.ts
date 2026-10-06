import { z } from "zod";

import type { MeetingHistorySummary } from "../analytics/meeting-history-summary.js";
import { calculateTalkTime, type ParticipantTalkTime } from "../analytics/talk-time.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
import { getCostDetail } from "./postgres-analytics-costs.js";
import { getDashboardAnalytics, getMeetingCostAnalytics } from "./postgres-analytics-dashboard.js";
import { createMeetingHistoryDetail } from "./postgres-analytics-meeting-detail.js";
import type { PostgresExecutor } from "./postgres-database.js";

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
  cost: DashboardCost;
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
    phase: "transcription" | "refinement" | "summary";
    provider: string;
  }[];
  confirmed: { amount: string; currency: string }[];
}

type CostPhase = CostAnalytics["breakdown"][number]["phase"];
type ConfirmedAmount = CostAnalytics["confirmed"][number];

/** Overview cost: the confirmed total and each stage, without providers or attempt counts. */
export interface DashboardCost {
  confirmed: ConfirmedAmount[];
  /** Every stage in pipeline order; `executions` lists how it ran in the period, if at all. */
  stages: { confirmed: ConfirmedAmount[]; executions: ("api" | "local")[]; phase: CostPhase }[];
}

/** Calendar dates in the browser's zone; both ends are inclusive. */
export interface CostDetailOptions {
  dateFrom: string;
  dateTo: string;
  timeZone: string;
}

export interface CostDetail {
  attemptCounts: CostAttemptCounts;
  confirmed: ConfirmedAmount[];
  meetingCount: number;
  models: {
    attemptCounts: CostAttemptCounts;
    chargedFailures: { confirmed: ConfirmedAmount[]; count: number };
    confirmed: ConfirmedAmount[];
    execution: "api" | "local";
    model: string | null;
    phase: CostPhase;
    provider: string;
  }[];
  stages: { attemptCounts: CostAttemptCounts; confirmed: ConfirmedAmount[]; phase: CostPhase }[];
  topMeetings: {
    confirmed: ConfirmedAmount[];
    meetingId: string;
    startedAt: string;
    voiceChannelName: string | null;
  }[];
}

export interface DashboardAnalyticsOptions {
  now?: string;
  period: DashboardPeriod;
  timeZone: string;
}

export interface MeetingHistoryItem {
  aiProfile: { name: string; profileId: string } | null;
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
WITH persisted_participants AS (
  INSERT INTO meeting_participants (
    meeting_id, guild_id, user_id, display_name, talk_time_ms, talk_percentage
  )
  SELECT $1, $2, item.user_id, item.display_name, item.talk_time_ms, item.talk_percentage
  FROM jsonb_to_recordset($3::jsonb) AS item(
    user_id text, display_name text, talk_time_ms bigint, talk_percentage smallint
  )
  ON CONFLICT (meeting_id, user_id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    talk_time_ms = EXCLUDED.talk_time_ms,
    talk_percentage = EXCLUDED.talk_percentage
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
    return getDashboardAnalytics(this.#database, guildId, options);
  }

  public async getCostDetail(guildId: string, options: CostDetailOptions): Promise<CostDetail> {
    return getCostDetail(this.#database, identifierSchema.parse(guildId), options);
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
    const meeting = await this.#mapMeetingRow(row, validatedGuildId);
    const cost = await this.#getMeetingCost(validatedGuildId, validatedMeetingId);
    return createMeetingHistoryDetail({ cost, guildId: validatedGuildId, meeting, row });
  }

  async #getMeetingCost(guildId: string, meetingId: string): Promise<CostAnalytics> {
    return getMeetingCostAnalytics(this.#database, guildId, meetingId);
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
      aiProfile:
        parsed.ai_profile_id === undefined ||
        parsed.ai_profile_id === null ||
        parsed.ai_profile_name === undefined ||
        parsed.ai_profile_name === null
          ? null
          : { name: parsed.ai_profile_name, profileId: parsed.ai_profile_id },
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
    nullWhenUndefined(filters.meetingId),
    nullWhenUndefined(filters.dateFrom),
    nullWhenUndefined(filters.dateTo),
    nullWhenUndefined(filters.state),
    filters.timeZone,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
    nullWhenUndefined(filters.channelName),
    nullWhenUndefined(filters.contentRetained),
    nullWhenUndefined(filters.participantUserId),
  ];
}

function nullWhenUndefined<T>(value: T | undefined): T | null {
  return value ?? null;
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
