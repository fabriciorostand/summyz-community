import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations21: readonly DatabaseMigration[] = [
  {
    version: 21,
    sql: `
ALTER TABLE installation_discord_connection
  ADD COLUMN avatar_url text,
  ADD COLUMN profile_updated_at timestamptz;
`,
  },
];
