import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations15: readonly DatabaseMigration[] = [
  {
    version: 15,
    sql: `
ALTER TABLE ai_profiles
  ALTER COLUMN profile_type DROP NOT NULL,
  DROP CONSTRAINT ai_profiles_profile_type_check,
  ADD CONSTRAINT ai_profiles_profile_type_check CHECK (profile_type IN ('external', 'local', 'hybrid'));
DROP INDEX ai_profiles_type_name_unique_idx;
CREATE TABLE model_catalog_cache (
  cache_key text PRIMARY KEY,
  snapshot jsonb NOT NULL
);
CREATE TABLE model_downloads (
  download_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('ollama', 'faster-whisper')),
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'downloading', 'completed', 'cancelling', 'cancelled', 'failed')),
  completed_bytes bigint NOT NULL DEFAULT 0,
  total_bytes bigint,
  partial_digests jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX model_downloads_active_model_idx ON model_downloads (provider, model)
  WHERE status IN ('queued', 'downloading', 'cancelling');
`,
  },
];
