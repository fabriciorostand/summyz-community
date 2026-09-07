import { z } from "zod";

import {
  createMeetingHistorySummary,
  type MeetingHistorySummary,
} from "../analytics/meeting-history-summary.js";
import { calculateTalkTime, type ParticipantTalkTime } from "../analytics/talk-time.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
import type { PostgresExecutor } from "./postgres-database.js";

const identifierSchema = z.string().min(1).max(128);
const historyStateSchema = z.enum(["completed", "failed", "in_progress"]);
export type HistoryState = z.infer<typeof historyStateSchema>;

const participantRowSchema = z.object({
  display_name: z.string(),
  talk_percentage: z.coerce.number().int().min(0).max(100).nullable(),
  talk_time_ms: z.coerce.number().int().nonnegative().nullable(),
  user_id: z.string(),
});

export interface AnalyticsParticipant {
  displayName: string;
  percentage: number | null;
  talkTimeMs: number | null;
  userId: string;
}

export interface DashboardAnalytics {
  averageDurationMs: number;
  confirmedCost: { amount: number; currency: string }[];
  hasUnresolvedCosts: boolean;
  topSpeakers: { displayName: string; talkTimeMs: number; userId: string }[];
  totalCalls: number;
  totalDurationMs: number;
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
  dateFrom?: string;
  dateTo?: string;
  meetingId?: string;
  page: number;
  pageSize: number;
  state?: HistoryState;
  timeZone: string;
}

export interface MeetingHistoryDetail extends MeetingHistoryItem {
  rawTranscript: string | null;
  summary: MeetingHistorySummary | null;
  transcript: string | null;
}

export class PostgresAnalyticsStore {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
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

  public async getDashboard(guildId: string): Promise<DashboardAnalytics> {
    const validatedGuildId = identifierSchema.parse(guildId);
    const [meetings, costs, speakers] = await Promise.all([
      this.#database.query(
        `SELECT
          count(*)::int AS total_calls,
          COALESCE(sum(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000), 0)::float8 AS total_duration_ms,
          COALESCE(avg(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000), 0)::float8 AS average_duration_ms
         FROM meetings WHERE guild_id = $1 AND pipeline_status = 'completed'`,
        [validatedGuildId],
      ),
      this.#database.query(
        `SELECT currency, COALESCE(sum(cost), 0)::float8 AS amount
         FROM provider_cost_attempts
         WHERE guild_id = $1 AND financial_status = 'confirmed'
         GROUP BY currency ORDER BY currency`,
        [validatedGuildId],
      ),
      this.#database.query(
        `WITH totals AS (
           SELECT participant.user_id, sum(participant.talk_time_ms)::bigint AS talk_time_ms
           FROM meeting_participants participant
           JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
           WHERE participant.guild_id = $1 AND meeting.pipeline_status = 'completed'
             AND meeting.talk_time_available = true
           GROUP BY participant.user_id
         ), latest_names AS (
           SELECT DISTINCT ON (participant.user_id) participant.user_id, participant.display_name
           FROM meeting_participants participant
           JOIN meetings meeting ON meeting.meeting_id = participant.meeting_id
           WHERE participant.guild_id = $1
           ORDER BY participant.user_id, meeting.started_at DESC
         )
         SELECT totals.user_id, latest_names.display_name, totals.talk_time_ms
         FROM totals JOIN latest_names USING (user_id)
         ORDER BY totals.talk_time_ms DESC, totals.user_id
         LIMIT 5`,
        [validatedGuildId],
      ),
    ]);
    const unresolved = await this.#database.query(
      `SELECT EXISTS(
        SELECT 1 FROM provider_cost_attempts
        WHERE guild_id = $1 AND financial_status IN ('pending', 'unattributed')
      ) AS has_unresolved`,
      [validatedGuildId],
    );
    const meetingRow = z
      .object({
        average_duration_ms: z.coerce.number().nonnegative(),
        total_calls: z.coerce.number().int().nonnegative(),
        total_duration_ms: z.coerce.number().nonnegative(),
      })
      .parse(meetings.rows[0]);
    return {
      averageDurationMs: Math.round(meetingRow.average_duration_ms),
      confirmedCost: costs.rows.map((row) => {
        const parsed = z
          .object({ amount: z.coerce.number(), currency: z.string().length(3) })
          .parse(row);
        return parsed;
      }),
      hasUnresolvedCosts: z.object({ has_unresolved: z.boolean() }).parse(unresolved.rows[0])
        .has_unresolved,
      topSpeakers: speakers.rows.map((row) => {
        const parsed = z
          .object({
            display_name: z.string(),
            talk_time_ms: z.coerce.number(),
            user_id: z.string(),
          })
          .parse(row);
        return {
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
    return {
      ...(await this.#mapMeetingRow(row, validatedGuildId)),
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

  async #mapMeetingRow(row: Record<string, unknown>, guildId: string): Promise<MeetingHistoryItem> {
    const parsed = z
      .object({
        completed_at: z.coerce.date().nullable(),
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
      `SELECT user_id, display_name, talk_time_ms, talk_percentage
       FROM meeting_participants WHERE guild_id = $1 AND meeting_id = $2
       ORDER BY talk_percentage DESC, user_id`,
      [guildId, meetingId],
    );
    return result.rows.map((row) => {
      const parsed = participantRowSchema.parse(row);
      return {
        displayName: parsed.display_name,
        percentage: parsed.talk_percentage,
        talkTimeMs: parsed.talk_time_ms,
        userId: parsed.user_id,
      };
    });
  }
}

const meetingHistoryFiltersSchema = z.object({
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  meetingId: identifierSchema.optional(),
  page: z.number().int().positive(),
  pageSize: z.number().int().min(1).max(100),
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
  ];
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
