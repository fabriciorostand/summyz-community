import { databaseMigrations1To5 } from "./migrations-1-5.js";
import { databaseMigrations6To11 } from "./migrations-6-11.js";
import { databaseMigrations12 } from "./migrations-12.js";
import { databaseMigrations13 } from "./migrations-13.js";
import { databaseMigrations14 } from "./migrations-14.js";
import { databaseMigrations15 } from "./migrations-15.js";

import { databaseMigrations16 } from "./migrations-16.js";

export type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations = [
  ...databaseMigrations1To5,
  ...databaseMigrations6To11,
  ...databaseMigrations12,
  ...databaseMigrations13,
  ...databaseMigrations14,
  ...databaseMigrations15,
  ...databaseMigrations16,
] as const;
