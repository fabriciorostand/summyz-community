import { databaseMigrations1To5 } from "./migrations-1-5.js";
import { databaseMigrations6To11 } from "./migrations-6-11.js";
import { databaseMigrations12 } from "./migrations-12.js";
import { databaseMigrations13 } from "./migrations-13.js";
import { databaseMigrations14 } from "./migrations-14.js";
import { databaseMigrations15 } from "./migrations-15.js";

import { databaseMigrations16 } from "./migrations-16.js";
import { databaseMigrations17 } from "./migrations-17.js";
import { databaseMigrations18 } from "./migrations-18.js";
import { databaseMigrations19 } from "./migrations-19.js";
import { databaseMigrations20 } from "./migrations-20.js";
import { databaseMigrations21 } from "./migrations-21.js";

export type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations = [
  ...databaseMigrations1To5,
  ...databaseMigrations6To11,
  ...databaseMigrations12,
  ...databaseMigrations13,
  ...databaseMigrations14,
  ...databaseMigrations15,
  ...databaseMigrations16,
  ...databaseMigrations17,
  ...databaseMigrations18,
  ...databaseMigrations19,
  ...databaseMigrations20,
  ...databaseMigrations21,
] as const;
