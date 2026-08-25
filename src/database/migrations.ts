export interface DatabaseMigration {
  sql: string;
  version: number;
}

export const databaseMigrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE meetings (
  meeting_id text PRIMARY KEY,
  guild_id text NOT NULL,
  voice_channel_id text NOT NULL,
  notification_channel_id text NOT NULL,
  recording_status text NOT NULL CHECK (recording_status IN ('recording', 'interrupted', 'completed')),
  pipeline_status text NOT NULL CHECK (
    pipeline_status IN ('recording', 'queued', 'transcribing', 'refining', 'summarizing', 'publishing', 'completed', 'failed')
  ),
  manifest jsonb,
  persist_content boolean NOT NULL,
  persist_audio boolean NOT NULL,
  storage_mode text NOT NULL CHECK (storage_mode IN ('local', 'postgres')),
  failure_code text,
  artifacts_deleted_at timestamptz,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meetings_guild_started_at_idx ON meetings (guild_id, started_at DESC);
CREATE INDEX meetings_recovery_idx ON meetings (recording_status, pipeline_status);

CREATE TABLE processing_jobs (
  job_id uuid PRIMARY KEY,
  meeting_id text NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('transcription', 'refinement', 'summary')),
  status text NOT NULL CHECK (status IN ('scheduled', 'active', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL,
  lease_expires_at timestamptz,
  lease_owner text,
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (meeting_id, job_type)
);

CREATE INDEX processing_jobs_claim_idx
  ON processing_jobs (available_at, created_at)
  WHERE status IN ('scheduled', 'active');

CREATE TABLE meeting_contents (
  meeting_id text PRIMARY KEY REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  raw_transcript text NOT NULL,
  transcript text NOT NULL,
  summary jsonb NOT NULL,
  publication jsonb NOT NULL,
  meeting_manifest jsonb NOT NULL,
  persisted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE meeting_audio_segments (
  meeting_id text NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  segment_id text NOT NULL,
  user_id text NOT NULL,
  user_display_name text NOT NULL,
  relative_path text NOT NULL,
  format text NOT NULL CHECK (format IN ('ogg_opus', 'pcm_s16le')),
  status text NOT NULL CHECK (status IN ('ready', 'conversion_failed')),
  started_at_ms double precision NOT NULL CHECK (started_at_ms >= 0),
  ended_at_ms double precision NOT NULL CHECK (ended_at_ms >= 0),
  duration_ms double precision NOT NULL CHECK (duration_ms >= 0),
  PRIMARY KEY (meeting_id, segment_id)
);

CREATE TABLE guild_configurations (
  guild_id text PRIMARY KEY,
  recording_role_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary_forum jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
] as const;
