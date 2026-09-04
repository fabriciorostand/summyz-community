import { createHash } from "node:crypto";

import type { DatabaseMigration } from "./migrations.js";

const FIRST_GUARDED_MIGRATION_VERSION = 10;
const PROTECTED_MEETING_TABLES = [
  "meeting_audio_segments",
  "meeting_contents",
  "meetings",
  "processing_jobs",
  "provider_cost_attempts",
] as const;

interface ForbiddenSqlOperation {
  label: string;
  pattern: RegExp;
}

const protectedTableAlternation = PROTECTED_MEETING_TABLES.join("|");
const forbiddenSqlOperations: readonly ForbiddenSqlOperation[] = [
  { label: "DELETE", pattern: /\bDELETE\s+FROM\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
  { label: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { label: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { label: "CASCADE", pattern: /\bCASCADE\b/i },
  { label: "MERGE", pattern: /\bMERGE\b/i },
  {
    label: "ON CONFLICT DO UPDATE",
    pattern: /\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b/i,
  },
  {
    label: "UPDATE on meeting data",
    pattern: new RegExp(
      `\\bUPDATE\\s+(?:ONLY\\s+)?(?:"?[A-Za-z_][A-Za-z0-9_$]*"?\\.)?"?(?:${protectedTableAlternation})"?\\b`,
      "i",
    ),
  },
];

export class UnsafeDatabaseMigrationError extends Error {
  public constructor(version: number, operation: string) {
    super(`Database migration ${version} contains forbidden operation: ${operation}`);
    this.name = "UnsafeDatabaseMigrationError";
  }
}

export class DatabaseMigrationIntegrityError extends Error {
  public constructor(version: number) {
    super(`Database migration ${version} does not match its recorded checksum`);
    this.name = "DatabaseMigrationIntegrityError";
  }
}

export function assertSafeDatabaseMigrations(migrations: readonly DatabaseMigration[]): void {
  let previousVersion = 0;
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.version) || migration.version <= previousVersion) {
      throw new UnsafeDatabaseMigrationError(migration.version, "invalid version ordering");
    }
    previousVersion = migration.version;
    if (migration.version < FIRST_GUARDED_MIGRATION_VERSION) continue;

    const executableSql = stripCommentsAndStringLiterals(migration.sql);
    const forbidden = forbiddenSqlOperations.find(({ pattern }) => pattern.test(executableSql));
    if (forbidden !== undefined) {
      throw new UnsafeDatabaseMigrationError(migration.version, forbidden.label);
    }
  }
}

export function databaseMigrationChecksum(migration: DatabaseMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\0${migration.sql}`, "utf8")
    .digest("hex");
}

function stripCommentsAndStringLiterals(sql: string): string {
  let output = "";
  let index = 0;
  let blockCommentDepth = 0;
  let inLineComment = false;
  let inString = false;

  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
        output += "\n";
      } else {
        output += " ";
      }
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      if (current === "/" && next === "*") {
        blockCommentDepth += 1;
        output += "  ";
        index += 2;
        continue;
      }
      if (current === "*" && next === "/") {
        blockCommentDepth -= 1;
        output += "  ";
        index += 2;
        continue;
      }
      output += current === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (inString) {
      if (current === "'" && next === "'") {
        output += "  ";
        index += 2;
        continue;
      }
      if (current === "'") {
        inString = false;
      }
      output += current === "\n" ? "\n" : " ";
      index += 1;
      continue;
    }

    if (current === "-" && next === "-") {
      inLineComment = true;
      output += "  ";
      index += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      blockCommentDepth = 1;
      output += "  ";
      index += 2;
      continue;
    }
    if (current === "'") {
      inString = true;
      output += " ";
      index += 1;
      continue;
    }

    output += current;
    index += 1;
  }

  return output;
}
