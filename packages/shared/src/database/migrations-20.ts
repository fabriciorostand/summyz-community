import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations20: readonly DatabaseMigration[] = [
  {
    version: 20,
    sql: `
DROP TABLE local_hardware_snapshot;
`,
  },
];
