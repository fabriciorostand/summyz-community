import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations13: readonly DatabaseMigration[] = [
  {
    version: 13,
    sql: `
ALTER TABLE guild_configurations
  ADD COLUMN recording_user_grants jsonb NOT NULL DEFAULT '[]'::jsonb;
`,
  },
] as const;
