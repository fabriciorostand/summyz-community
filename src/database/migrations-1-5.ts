import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations1To5: readonly DatabaseMigration[] = [
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

CREATE TABLE installation_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  discord_client_id text,
  owner_discord_user_id text,
  dashboard_language text NOT NULL DEFAULT 'pt-BR'
    CHECK (dashboard_language IN ('en', 'pt-BR')),
  dashboard_theme text NOT NULL DEFAULT 'system'
    CHECK (dashboard_theme IN ('system', 'light', 'dark')),
  setup_completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO installation_settings (singleton) VALUES (true);

CREATE TABLE dashboard_sessions (
  session_id uuid PRIMARY KEY,
  discord_user_id text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_sessions_owner_active_idx
  ON dashboard_sessions (discord_user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE discord_connections (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  discord_user_id text NOT NULL,
  discord_username text NOT NULL,
  discord_avatar text,
  encrypted_oauth_credentials text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE discord_oauth_states (
  state_hash text PRIMARY KEY,
  intent text NOT NULL CHECK (intent IN ('setup', 'login', 'replace', 'recovery')),
  initiator_discord_user_id text,
  encrypted_code_verifier text NOT NULL,
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX discord_oauth_states_active_idx
  ON discord_oauth_states (intent, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE installation_secrets (
  secret_name text PRIMARY KEY CHECK (
    secret_name IN (
      'discord_bot_token',
      'discord_client_secret',
      'openrouter_api_key'
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
  ADD COLUMN owner_discord_user_id text,
  ADD COLUMN profile_type text CHECK (profile_type IN ('external', 'local')),
  ADD CONSTRAINT ai_profiles_personal_scope_check CHECK (
    (owner_discord_user_id IS NULL AND profile_type IS NULL)
    OR
    (owner_discord_user_id IS NOT NULL AND profile_type IS NOT NULL)
  );

CREATE UNIQUE INDEX ai_profiles_personal_name_unique_idx
  ON ai_profiles (owner_discord_user_id, profile_type, lower(name))
  WHERE owner_discord_user_id IS NOT NULL;

CREATE INDEX ai_profiles_owner_type_idx
  ON ai_profiles (owner_discord_user_id, profile_type, created_at)
  WHERE owner_discord_user_id IS NOT NULL;

ALTER TABLE guild_configurations
  ADD CONSTRAINT guild_configurations_active_ai_profile_fk
  FOREIGN KEY (active_ai_profile_id)
  REFERENCES ai_profiles(profile_id)
  ON DELETE RESTRICT;
`,
  },
] as const;
