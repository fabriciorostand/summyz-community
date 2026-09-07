import { databaseMigrations1To5 } from "./migrations-1-5.js";
import { databaseMigrations6To11 } from "./migrations-6-11.js";

export type { DatabaseMigration } from "./database-migration.js";

export const databaseMigrations = [...databaseMigrations1To5, ...databaseMigrations6To11] as const;
