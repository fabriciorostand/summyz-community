import { databaseMigrations1To5 } from "./migrations-1-5.js";
import { databaseMigrations6To11 } from "./migrations-6-11.js";
import { databaseMigrations12 } from "./migrations-12.js";

export type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations = [
  ...databaseMigrations1To5,
  ...databaseMigrations6To11,
  ...databaseMigrations12,
] as const;
