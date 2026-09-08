import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations12: readonly DatabaseMigration[] = [
  {
    version: 12,
    sql: `
ALTER TABLE dashboard_users
  ADD COLUMN dashboard_theme text NOT NULL DEFAULT 'system'
    CHECK (dashboard_theme IN ('system', 'light', 'dark'));

ALTER TABLE meetings
  ADD COLUMN ai_profile_id text,
  ADD COLUMN ai_profile_name text,
  ADD COLUMN publication_thread_id text,
  ADD COLUMN publication_root_message_id text;

ALTER TABLE meeting_participants
  ADD COLUMN avatar_url text;

CREATE TABLE meeting_tasks (
  task_id uuid PRIMARY KEY,
  meeting_id text NOT NULL,
  guild_id text NOT NULL,
  task_index integer NOT NULL CHECK (task_index >= 0),
  task_text text NOT NULL CHECK (length(task_text) > 0),
  source_entry_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_name text,
  owner_user_id text,
  deadline_text text,
  deadline_date date,
  deadline_time time,
  deadline_time_zone text,
  deadline_precision text CHECK (deadline_precision IN ('date', 'minute')),
  completed_at timestamptz,
  completed_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, task_index),
  FOREIGN KEY (meeting_id, guild_id)
    REFERENCES meetings(meeting_id, guild_id)
    ON DELETE RESTRICT,
  CHECK (
    (deadline_date IS NULL AND deadline_time IS NULL AND deadline_time_zone IS NULL AND deadline_precision IS NULL)
    OR
    (deadline_date IS NOT NULL AND deadline_time_zone IS NOT NULL AND deadline_precision = 'date' AND deadline_time IS NULL)
    OR
    (deadline_date IS NOT NULL AND deadline_time_zone IS NOT NULL AND deadline_precision = 'minute' AND deadline_time IS NOT NULL)
  ),
  CHECK (
    (completed_at IS NULL AND completed_by_user_id IS NULL)
    OR (completed_at IS NOT NULL AND completed_by_user_id IS NOT NULL)
  )
);

CREATE INDEX meeting_tasks_guild_open_idx
  ON meeting_tasks (guild_id, deadline_date, deadline_time)
  WHERE completed_at IS NULL;
CREATE INDEX meeting_tasks_owner_idx
  ON meeting_tasks (guild_id, owner_user_id, created_at DESC);

CREATE TABLE live_meeting_states (
  meeting_id text PRIMARY KEY REFERENCES meetings(meeting_id) ON DELETE RESTRICT,
  guild_id text NOT NULL,
  voice_channel_id text NOT NULL,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  speaking_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (meeting_id, guild_id)
    REFERENCES meetings(meeting_id, guild_id)
    ON DELETE RESTRICT
);

CREATE INDEX live_meeting_states_guild_idx
  ON live_meeting_states (guild_id, expires_at DESC);

CREATE TABLE runtime_component_heartbeats (
  component_id text PRIMARY KEY,
  component_type text NOT NULL CHECK (component_type IN (
    'bot', 'database', 'ffmpeg', 'worker', 'queue', 'ollama', 'faster_whisper', 'openrouter', 'smtp'
  )),
  status text NOT NULL CHECK (status IN ('ready', 'degraded', 'unavailable', 'not_configured')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX runtime_component_heartbeats_type_idx
  ON runtime_component_heartbeats (component_type, heartbeat_at DESC);
`,
  },
] as const;
