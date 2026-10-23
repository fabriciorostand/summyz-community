import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations14: readonly DatabaseMigration[] = [
  {
    version: 14,
    sql: `
ALTER TABLE ai_profiles
  DROP CONSTRAINT ai_profiles_translation_check;
`,
  },
] as const;
