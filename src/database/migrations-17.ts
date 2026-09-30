import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations17: readonly DatabaseMigration[] = [
  {
    version: 17,
    sql: `
ALTER TABLE installation_secrets
  DROP CONSTRAINT installation_secrets_secret_name_check,
  ADD CONSTRAINT installation_secrets_secret_name_check CHECK (
    secret_name IN ('discord_bot_token', 'discord_client_secret', 'openrouter_api_key')
  );

CREATE TABLE installation_discord_connection (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  discord_user_id text NOT NULL,
  discord_username text NOT NULL,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  generation bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE installation_oauth_states (
  state_hash text PRIMARY KEY,
  browser_binding_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guild_owner_approvals (
  guild_id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
