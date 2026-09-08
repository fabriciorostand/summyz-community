import { randomUUID } from "node:crypto";

import { z } from "zod";

import { type RecordingManifest, recordingManifestSchema } from "../recording/manifest.js";
import type { ManifestIndex } from "../recording/manifest-store.js";
import { CURRENT_TRANSCRIPTION_RECOVERY_VERSION } from "../transcription/transcription-recovery-policy.js";
import type { PostgresExecutor } from "./postgres-database.js";

const pipelineStatusSchema = z.enum([
  "recording",
  "queued",
  "transcribing",
  "refining",
  "summarizing",
  "publishing",
  "completed",
  "failed",
]);
export type MeetingPipelineStatus = z.infer<typeof pipelineStatusSchema>;

const failureCodeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_]+$/);

export class PostgresMeetingStore implements ManifestIndex {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async save(manifest: RecordingManifest): Promise<void> {
    const validated = recordingManifestSchema.parse(manifest);
    await this.#database.query(
      `
WITH saved_meeting AS (
INSERT INTO meetings (
  meeting_id,
  guild_id,
  voice_channel_id,
  notification_channel_id,
  recording_status,
  pipeline_status,
  manifest,
  persist_content,
  persist_audio,
  storage_mode,
  started_at,
  completed_at
  , voice_channel_name,
  ai_profile_id,
  ai_profile_name
) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $15, $17, $18)
ON CONFLICT (meeting_id) DO UPDATE SET
  guild_id = EXCLUDED.guild_id,
  voice_channel_id = EXCLUDED.voice_channel_id,
  notification_channel_id = EXCLUDED.notification_channel_id,
  recording_status = EXCLUDED.recording_status,
  pipeline_status = CASE
    WHEN meetings.pipeline_status IN (
      'transcribing', 'refining', 'summarizing', 'publishing', 'completed', 'failed'
    ) THEN meetings.pipeline_status
    ELSE EXCLUDED.pipeline_status
  END,
  manifest = EXCLUDED.manifest,
  completed_at = EXCLUDED.completed_at,
  voice_channel_name = EXCLUDED.voice_channel_name,
  ai_profile_id = COALESCE(meetings.ai_profile_id, EXCLUDED.ai_profile_id),
  ai_profile_name = COALESCE(meetings.ai_profile_name, EXCLUDED.ai_profile_name),
  updated_at = now()
RETURNING meeting_id
)
INSERT INTO processing_jobs (
  job_id, meeting_id, job_type, status, available_at, max_attempts,
  transcription_recovery_version
)
SELECT $13, meeting_id, 'transcription', 'scheduled', $14, 6, $16
FROM saved_meeting
WHERE $5 = 'completed'
ON CONFLICT (meeting_id, job_type) DO NOTHING
`,
      meetingQueryValues(validated),
    );
    await persistParticipants(this.#database, validated);
  }

  public async listCompleted(): Promise<RecordingManifest[]> {
    return this.#listByRecordingStatus("completed", false);
  }

  public async listRecoverable(): Promise<RecordingManifest[]> {
    return this.#listByRecordingStatus("completed", true);
  }

  public async load(meetingId: string): Promise<RecordingManifest> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    const result = await this.#database.query(
      "SELECT manifest FROM meetings WHERE meeting_id = $1",
      [validatedMeetingId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("A reunião não existe no PostgreSQL");
    }
    return recordingManifestSchema.parse(row.manifest);
  }

  public async updatePipeline(
    meetingId: string,
    status: MeetingPipelineStatus,
    failureCode?: string,
  ): Promise<void> {
    const validatedMeetingId = z.string().min(1).max(128).parse(meetingId);
    const validatedStatus = pipelineStatusSchema.parse(status);
    const validatedFailureCode =
      failureCode === undefined ? null : failureCodeSchema.parse(failureCode);
    await this.#database.query(
      `
UPDATE meetings
SET
  pipeline_status = $2,
  failure_code = $3,
  manifest = CASE WHEN $2 IN ('completed', 'failed') THEN NULL ELSE manifest END,
  updated_at = now()
WHERE meeting_id = $1
`,
      [validatedMeetingId, validatedStatus, validatedFailureCode],
    );
  }

  public async listTerminalMeetingIds(): Promise<string[]> {
    const result = await this.#database.query(
      `SELECT meeting_id
       FROM meetings
       WHERE pipeline_status IN ('completed', 'failed')
         AND artifacts_deleted_at IS NULL
         AND (artifacts_delete_after IS NULL OR artifacts_delete_after <= now())
       ORDER BY created_at`,
    );
    return result.rows.map((row) => z.string().min(1).max(128).parse(row.meeting_id));
  }

  public async markArtifactsDeleted(meetingId: string): Promise<void> {
    await this.#database.query(
      `UPDATE meetings
       SET artifacts_deleted_at = now(), manifest = NULL,
           transcription_recovery_reason = NULL, artifacts_delete_after = NULL,
           updated_at = now()
       WHERE meeting_id = $1`,
      [z.string().min(1).max(128).parse(meetingId)],
    );
  }

  async #listByRecordingStatus(
    status: RecordingManifest["status"],
    negate: boolean,
  ): Promise<RecordingManifest[]> {
    const result = await this.#database.query(
      `
SELECT manifest
FROM meetings
WHERE recording_status ${negate ? "<>" : "="} $1
  AND manifest IS NOT NULL
ORDER BY started_at
`,
      [status],
    );
    return result.rows.map((row) => recordingManifestSchema.parse(row.manifest));
  }
}

type ValidatedManifest = z.infer<typeof recordingManifestSchema>;

function meetingQueryValues(manifest: ValidatedManifest): readonly unknown[] {
  return [
    manifest.meetingId,
    manifest.guildId,
    manifest.voiceChannelId,
    manifest.notificationChannelId,
    manifest.status,
    pipelineStatusFor(manifest.status),
    JSON.stringify(manifest),
    manifest.persistMeetingContent,
    manifest.persistMeetingAudio,
    manifest.storageMode,
    manifest.startedAt,
    nullWhenUndefined(manifest.completedAt),
    randomUUID(),
    new Date().toISOString(),
    nullWhenUndefined(manifest.voiceChannelName),
    CURRENT_TRANSCRIPTION_RECOVERY_VERSION,
    nullWhenUndefined(manifest.aiProfile?.profileId),
    nullWhenUndefined(manifest.aiProfile?.name),
  ];
}

function pipelineStatusFor(status: RecordingManifest["status"]): MeetingPipelineStatus {
  return status === "completed" ? "queued" : "recording";
}

async function persistParticipants(
  database: PostgresExecutor,
  manifest: ValidatedManifest,
): Promise<void> {
  if (manifest.participants.length === 0) return;
  await database.query(
    `INSERT INTO meeting_participants (meeting_id, guild_id, user_id, display_name, avatar_url)
     SELECT $1, $2, participant.user_id, participant.display_name, participant.avatar_url
     FROM jsonb_to_recordset($3::jsonb) AS participant(
       user_id text, display_name text, avatar_url text
     )
     ON CONFLICT (meeting_id, user_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url`,
    [
      manifest.meetingId,
      manifest.guildId,
      JSON.stringify(
        manifest.participants.map((participant) => ({
          avatar_url: nullWhenUndefined(participant.avatarUrl),
          display_name: participant.displayName,
          user_id: participant.userId,
        })),
      ),
    ],
  );
}

function nullWhenUndefined<T>(value: T | undefined): T | null {
  return value ?? null;
}
