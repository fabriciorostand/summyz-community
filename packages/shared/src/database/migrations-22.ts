import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations22: readonly DatabaseMigration[] = [
  {
    version: 22,
    sql: `
ALTER TABLE meeting_tasks
  ADD COLUMN owner_names text[];
`,
  },
];
