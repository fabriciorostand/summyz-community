import type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations19: readonly DatabaseMigration[] = [
  {
    version: 19,
    sql: `
CREATE TABLE local_hardware_snapshot (
  snapshot_id text PRIMARY KEY CHECK (snapshot_id = 'host'),
  snapshot jsonb NOT NULL,
  detected_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
