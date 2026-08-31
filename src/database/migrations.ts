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
  {
    version: 2,
    sql: `
ALTER TABLE meetings
  ADD CONSTRAINT meetings_id_guild_unique UNIQUE (meeting_id, guild_id);

CREATE TABLE provider_cost_attempts (
  attempt_id text PRIMARY KEY,
  meeting_id text NOT NULL,
  guild_id text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('transcription', 'refinement', 'summary')),
  execution text NOT NULL CHECK (execution IN ('api', 'local')),
  provider text NOT NULL,
  model text,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  outcome text NOT NULL CHECK (outcome IN ('pending', 'success', 'failure')),
  financial_status text NOT NULL CHECK (
    financial_status IN ('pending', 'confirmed', 'unattributed', 'not_applicable')
  ),
  cost numeric,
  currency char(3),
  generation_id text,
  confirmation_source text CHECK (confirmation_source IN ('response', 'generation')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (meeting_id, guild_id)
    REFERENCES meetings(meeting_id, guild_id)
    ON DELETE RESTRICT,
  CHECK (
    (financial_status = 'confirmed' AND cost IS NOT NULL AND currency IS NOT NULL)
    OR
    (financial_status <> 'confirmed' AND cost IS NULL AND currency IS NULL)
  ),
  CHECK (execution <> 'local' OR financial_status = 'not_applicable'),
  CHECK (
    (outcome = 'pending' AND ended_at IS NULL)
    OR
    (outcome <> 'pending' AND ended_at IS NOT NULL)
  )
);

CREATE INDEX provider_cost_attempts_meeting_phase_idx
  ON provider_cost_attempts (meeting_id, phase, started_at);
CREATE INDEX provider_cost_attempts_guild_started_at_idx
  ON provider_cost_attempts (guild_id, started_at);
CREATE INDEX provider_cost_attempts_reconciliation_idx
  ON provider_cost_attempts (financial_status, provider)
  WHERE financial_status = 'pending';
CREATE INDEX provider_cost_attempts_generation_id_idx
  ON provider_cost_attempts (generation_id)
  WHERE generation_id IS NOT NULL;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE guild_configurations
  ADD COLUMN active_ai_profile_id text;

CREATE TABLE ai_profiles (
  profile_id text PRIMARY KEY,
  guild_id text NOT NULL REFERENCES guild_configurations(guild_id) ON DELETE CASCADE,
  name text NOT NULL,
  transcription jsonb NOT NULL,
  refinement jsonb NOT NULL,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, guild_id)
);

CREATE INDEX ai_profiles_guild_name_idx ON ai_profiles (guild_id, name);

ALTER TABLE guild_configurations
  ADD CONSTRAINT guild_configurations_active_ai_profile_fk
  FOREIGN KEY (active_ai_profile_id, guild_id)
  REFERENCES ai_profiles(profile_id, guild_id)
  ON DELETE RESTRICT;
`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE guild_configurations
  ADD COLUMN bot_language text NOT NULL DEFAULT 'en'
    CHECK (bot_language IN ('en', 'pt-BR')),
  ADD COLUMN persist_meeting_content boolean NOT NULL DEFAULT true,
  ADD COLUMN persist_meeting_audio boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX ai_profiles_guild_name_unique_idx
  ON ai_profiles (guild_id, lower(name));

CREATE TABLE dashboard_users (
  user_id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  dashboard_language text NOT NULL DEFAULT 'pt-BR'
    CHECK (dashboard_language IN ('en', 'pt-BR')),
  installation_role text NOT NULL DEFAULT 'member'
    CHECK (installation_role IN ('administrator', 'member')),
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);

CREATE UNIQUE INDEX dashboard_users_email_unique_idx ON dashboard_users (lower(email));

CREATE TABLE dashboard_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES dashboard_users(user_id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_sessions_user_active_idx
  ON dashboard_sessions (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE dashboard_auth_tokens (
  token_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES dashboard_users(user_id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_auth_tokens_active_idx
  ON dashboard_auth_tokens (user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE discord_connections (
  user_id uuid PRIMARY KEY REFERENCES dashboard_users(user_id) ON DELETE CASCADE,
  discord_user_id text NOT NULL UNIQUE,
  discord_username text NOT NULL,
  discord_avatar text,
  encrypted_oauth_credentials text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discord_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES dashboard_users(user_id) ON DELETE CASCADE,
  encrypted_code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discord_oauth_states_active_idx
  ON discord_oauth_states (user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE installation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  discord_client_id text,
  smtp_host text,
  smtp_port integer CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_secure boolean NOT NULL DEFAULT false,
  smtp_user text,
  smtp_from_email text,
  smtp_from_name text NOT NULL DEFAULT 'Summyz',
  smtp_reply_to text,
  registration_enabled boolean NOT NULL DEFAULT false,
  public_base_url text,
  setup_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO installation_settings (singleton) VALUES (true);

CREATE TABLE installation_secrets (
  secret_name text PRIMARY KEY CHECK (
    secret_name IN (
      'discord_bot_token',
      'discord_client_secret',
      'openrouter_api_key',
      'smtp_password'
    )
  ),
  encrypted_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    version: 5,
    sql: `
ALTER TABLE guild_configurations
  DROP CONSTRAINT guild_configurations_active_ai_profile_fk;

DROP INDEX ai_profiles_guild_name_unique_idx;
DROP INDEX ai_profiles_guild_name_idx;

ALTER TABLE ai_profiles
  ALTER COLUMN guild_id DROP NOT NULL,
  ADD COLUMN owner_user_id uuid REFERENCES dashboard_users(user_id) ON DELETE CASCADE,
  ADD COLUMN profile_type text CHECK (profile_type IN ('external', 'local')),
  ADD CONSTRAINT ai_profiles_personal_scope_check CHECK (
    (owner_user_id IS NULL AND profile_type IS NULL)
    OR
    (owner_user_id IS NOT NULL AND profile_type IS NOT NULL)
  );

CREATE UNIQUE INDEX ai_profiles_personal_name_unique_idx
  ON ai_profiles (owner_user_id, profile_type, lower(name))
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX ai_profiles_owner_type_idx
  ON ai_profiles (owner_user_id, profile_type, created_at)
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE guild_configurations
  ADD CONSTRAINT guild_configurations_active_ai_profile_fk
  FOREIGN KEY (active_ai_profile_id)
  REFERENCES ai_profiles(profile_id)
  ON DELETE RESTRICT;
`,
  },
  {
    version: 6,
    sql: `
UPDATE guild_configurations AS guild
SET active_ai_profile_id = NULL, updated_at = now()
FROM ai_profiles AS profile
WHERE guild.active_ai_profile_id = profile.profile_id
  AND (profile.owner_user_id IS NULL OR profile.profile_type IS NULL);

DELETE FROM ai_profiles
WHERE owner_user_id IS NULL OR profile_type IS NULL;

ALTER TABLE guild_configurations
  DROP CONSTRAINT guild_configurations_active_ai_profile_fk;

DROP INDEX ai_profiles_personal_name_unique_idx;
DROP INDEX ai_profiles_owner_type_idx;

ALTER TABLE ai_profiles
  DROP CONSTRAINT ai_profiles_personal_scope_check,
  DROP COLUMN guild_id,
  ALTER COLUMN owner_user_id SET NOT NULL,
  ALTER COLUMN profile_type SET NOT NULL;

ALTER TABLE meetings
  DROP CONSTRAINT meetings_storage_mode_check,
  ADD CONSTRAINT meetings_storage_mode_check CHECK (storage_mode = 'postgres');

CREATE UNIQUE INDEX ai_profiles_personal_name_unique_idx
  ON ai_profiles (owner_user_id, profile_type, lower(name));

CREATE INDEX ai_profiles_owner_type_idx
  ON ai_profiles (owner_user_id, profile_type, created_at);

ALTER TABLE guild_configurations
  ADD CONSTRAINT guild_configurations_active_ai_profile_fk
  FOREIGN KEY (active_ai_profile_id)
  REFERENCES ai_profiles(profile_id)
  ON DELETE RESTRICT;
`,
  },
  {
    version: 7,
    sql: `
ALTER TABLE meetings
  ADD COLUMN voice_channel_name text,
  ADD COLUMN talk_time_available boolean NOT NULL DEFAULT false;

CREATE TABLE meeting_participants (
  meeting_id text NOT NULL REFERENCES meetings(meeting_id) ON DELETE CASCADE,
  guild_id text NOT NULL,
  user_id text NOT NULL,
  display_name text NOT NULL,
  talk_time_ms bigint CHECK (talk_time_ms >= 0),
  talk_percentage smallint CHECK (talk_percentage BETWEEN 0 AND 100),
  PRIMARY KEY (meeting_id, user_id),
  FOREIGN KEY (meeting_id, guild_id) REFERENCES meetings(meeting_id, guild_id) ON DELETE CASCADE
);

CREATE INDEX meeting_participants_guild_user_idx
  ON meeting_participants (guild_id, user_id);

UPDATE ai_profiles
SET transcription = CASE
  WHEN profile_type = 'external' THEN transcription - 'timestampMode' - 'batchSize'
  ELSE transcription - 'timestampMode'
END;

UPDATE meetings
SET
  voice_channel_name = COALESCE(manifest->>'voiceChannelName', voice_channel_name),
  manifest = CASE WHEN manifest IS NULL THEN NULL ELSE
    jsonb_set(
      jsonb_set(
        CASE WHEN manifest#>>'{aiConfiguration,profileType}' = 'external'
          THEN manifest #- '{aiConfiguration,transcription,timestampMode}' #- '{aiConfiguration,transcription,batchSize}'
          ELSE manifest #- '{aiConfiguration,transcription,timestampMode}'
        END,
        '{participants}',
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'userId', participant->>'userId',
            'displayName', participant->>'userDisplayName'
          ))
          FROM (
            SELECT DISTINCT ON (segment->>'userId') segment AS participant
            FROM jsonb_array_elements(COALESCE(manifest->'segments', '[]'::jsonb)) AS segment
            ORDER BY segment->>'userId'
          ) inferred
        ), '[]'::jsonb),
        true
      ),
      '{schemaVersion}', '3'::jsonb, true
    )
  END
WHERE manifest IS NOT NULL;

UPDATE meeting_contents
SET meeting_manifest = jsonb_set(
  jsonb_set(
    CASE WHEN meeting_manifest#>>'{aiConfiguration,profileType}' = 'external'
      THEN meeting_manifest #- '{aiConfiguration,transcription,timestampMode}' #- '{aiConfiguration,transcription,batchSize}'
      ELSE meeting_manifest #- '{aiConfiguration,transcription,timestampMode}'
    END,
    '{participants}',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'userId', participant->>'userId',
        'displayName', participant->>'userDisplayName'
      ))
      FROM (
        SELECT DISTINCT ON (segment->>'userId') segment AS participant
        FROM jsonb_array_elements(COALESCE(meeting_manifest->'segments', '[]'::jsonb)) AS segment
        ORDER BY segment->>'userId'
      ) inferred
    ), '[]'::jsonb),
    true
  ),
  '{schemaVersion}', '3'::jsonb, true
);

UPDATE meetings meeting
SET voice_channel_name = COALESCE(meeting.voice_channel_name, content.meeting_manifest->>'voiceChannelName')
FROM meeting_contents content
WHERE content.meeting_id = meeting.meeting_id;

INSERT INTO meeting_participants (meeting_id, guild_id, user_id, display_name)
SELECT DISTINCT ON (meeting.meeting_id, participant->>'userId')
  meeting.meeting_id,
  meeting.guild_id,
  participant->>'userId',
  participant->>'displayName'
FROM meetings meeting
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(meeting.manifest->'participants', '[]'::jsonb)) participant
WHERE participant->>'userId' IS NOT NULL AND participant->>'displayName' IS NOT NULL
ON CONFLICT (meeting_id, user_id) DO NOTHING;

INSERT INTO meeting_participants (meeting_id, guild_id, user_id, display_name)
SELECT DISTINCT ON (meeting.meeting_id, participant->>'userId')
  meeting.meeting_id,
  meeting.guild_id,
  participant->>'userId',
  participant->>'displayName'
FROM meetings meeting
JOIN meeting_contents content ON content.meeting_id = meeting.meeting_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(content.meeting_manifest->'participants', '[]'::jsonb)) participant
WHERE participant->>'userId' IS NOT NULL AND participant->>'displayName' IS NOT NULL
ON CONFLICT (meeting_id, user_id) DO NOTHING;

INSERT INTO meeting_participants (meeting_id, guild_id, user_id, display_name)
SELECT DISTINCT ON (audio.meeting_id, audio.user_id)
  audio.meeting_id, meeting.guild_id, audio.user_id, audio.user_display_name
FROM meeting_audio_segments audio
JOIN meetings meeting ON meeting.meeting_id = audio.meeting_id
ORDER BY audio.meeting_id, audio.user_id, audio.started_at_ms DESC
ON CONFLICT (meeting_id, user_id) DO NOTHING;
`,
  },
  {
    version: 8,
    sql: `
WITH source AS (
  SELECT
    meeting_id,
    manifest,
    COALESCE(
      manifest#>>'{aiConfiguration,profileType}',
      CASE manifest#>>'{aiConfiguration,transcription,provider}'
        WHEN 'openrouter' THEN 'external'
        WHEN 'faster-whisper' THEN 'local'
      END
    ) AS profile_type
  FROM meetings
  WHERE manifest IS NOT NULL
), normalized AS (
  SELECT
    meeting_id,
    CASE
      WHEN manifest->'aiConfiguration' IS NULL OR profile_type IS NULL THEN manifest
      ELSE jsonb_set(
        CASE WHEN profile_type = 'external'
          THEN manifest #- '{aiConfiguration,transcription,timestampMode}' #- '{aiConfiguration,transcription,batchSize}'
          ELSE manifest #- '{aiConfiguration,transcription,timestampMode}'
        END,
        '{aiConfiguration,profileType}',
        to_jsonb(profile_type),
        true
      )
    END AS manifest
  FROM source
)
UPDATE meetings meeting
SET manifest = jsonb_set(normalized.manifest, '{storageMode}', '"postgres"'::jsonb, true)
FROM normalized
WHERE normalized.meeting_id = meeting.meeting_id;

WITH source AS (
  SELECT
    meeting_id,
    meeting_manifest,
    COALESCE(
      meeting_manifest#>>'{aiConfiguration,profileType}',
      CASE meeting_manifest#>>'{aiConfiguration,transcription,provider}'
        WHEN 'openrouter' THEN 'external'
        WHEN 'faster-whisper' THEN 'local'
      END
    ) AS profile_type
  FROM meeting_contents
), normalized AS (
  SELECT
    meeting_id,
    CASE
      WHEN meeting_manifest->'aiConfiguration' IS NULL OR profile_type IS NULL
        THEN meeting_manifest
      ELSE jsonb_set(
        CASE WHEN profile_type = 'external'
          THEN meeting_manifest #- '{aiConfiguration,transcription,timestampMode}' #- '{aiConfiguration,transcription,batchSize}'
          ELSE meeting_manifest #- '{aiConfiguration,transcription,timestampMode}'
        END,
        '{aiConfiguration,profileType}',
        to_jsonb(profile_type),
        true
      )
    END AS meeting_manifest
  FROM source
)
UPDATE meeting_contents content
SET meeting_manifest = jsonb_set(
  normalized.meeting_manifest,
  '{storageMode}',
  '"postgres"'::jsonb,
  true
)
FROM normalized
WHERE normalized.meeting_id = content.meeting_id;
`,
  },
] as const;
