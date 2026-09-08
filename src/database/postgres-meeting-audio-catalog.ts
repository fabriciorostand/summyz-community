import {
  createMeetingAudioCatalog,
  type MeetingAudioCatalog,
} from "../processing/meeting-audio-catalog.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { PostgresExecutor } from "./postgres-database.js";

export class PostgresMeetingAudioCatalog implements MeetingAudioCatalog {
  readonly #database: PostgresExecutor;

  public constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  public async persist(manifest: RecordingManifest): Promise<boolean> {
    if (!manifest.persistMeetingAudio) return false;
    const catalog = createMeetingAudioCatalog(manifest);
    await this.#database.query(
      `
WITH deleted AS (
  DELETE FROM meeting_audio_segments WHERE meeting_id = $1
)
INSERT INTO meeting_audio_segments (
  meeting_id, segment_id, user_id, user_display_name, relative_path,
  format, status, started_at_ms, ended_at_ms, duration_ms
)
SELECT
  $1, segment."segmentId", segment."userId", segment."userDisplayName",
  segment."relativePath", segment.format, segment.status,
  segment."startedAtMs", segment."endedAtMs", segment."durationMs"
FROM jsonb_to_recordset($2::jsonb) AS segment(
  "segmentId" text,
  "userId" text,
  "userDisplayName" text,
  "relativePath" text,
  format text,
  status text,
  "startedAtMs" double precision,
  "endedAtMs" double precision,
  "durationMs" double precision
)
`,
      [catalog.meetingId, JSON.stringify(catalog.segments)],
    );
    return true;
  }
}
