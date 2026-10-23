import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations18: readonly DatabaseMigration[] = [
  {
    version: 18,
    sql: `
CREATE TABLE guild_history (
  guild_id text PRIMARY KEY,
  guild_name text NOT NULL,
  icon_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
