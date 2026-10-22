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
// Tables holding meeting or configuration data, plus the migration ledger. Any other table may be
// dropped by a migration.
const DROP_PROTECTED_TABLES: ReadonlySet<string> = new Set([
  ...PROTECTED_MEETING_TABLES,
  "ai_profiles",
  "guild_configurations",
  "guild_history",
  "guild_owner_approvals",
  "installation_access",
  "installation_discord_connection",
  "installation_secrets",
  "installation_settings",
  "live_meeting_states",
  "meeting_participants",
  "meeting_tasks",
  "schema_migrations",
]);

interface ForbiddenSqlOperation {
  label: string;
  pattern: RegExp;
}

const protectedTableAlternation = PROTECTED_MEETING_TABLES.join("|");
const forbiddenSqlOperations: readonly ForbiddenSqlOperation[] = [
  { label: "DELETE", pattern: /\bDELETE\s+FROM\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\b/i },
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
    if (dropsProtectedTable(executableSql)) {
      throw new UnsafeDatabaseMigrationError(migration.version, "DROP TABLE on protected data");
    }
  }
}

const sqlIdentifier = `(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")+")`;
const qualifiedTableName = new RegExp(
  String.raw`^${sqlIdentifier}(?:\s*\.\s*${sqlIdentifier}){0,2}$`,
);

/** Fails closed: a drop target that is not a plain table name counts as protected. */
function dropsProtectedTable(sql: string): boolean {
  for (const statement of sql.matchAll(/\bDROP\s+TABLE\b(?:\s+IF\s+EXISTS\b)?([^;]*)/gi)) {
    const targets = (statement[1] ?? "").replace(/\s+RESTRICT\s*$/i, "").split(",");
    for (const target of targets.map((value) => value.trim())) {
      if (!qualifiedTableName.test(target)) return true;
      const name = [...target.matchAll(new RegExp(sqlIdentifier, "g"))].at(-1)?.[0] ?? "";
      const unquoted = name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name;
      if (DROP_PROTECTED_TABLES.has(unquoted.toLowerCase())) return true;
    }
  }
  return false;
}

export function databaseMigrationChecksum(migration: DatabaseMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\0${migration.sql}`, "utf8")
    .digest("hex");
}

function stripCommentsAndStringLiterals(sql: string): string {
  return new SqlLiteralMasker(sql).mask();
}

type SqlMaskState = "block-comment" | "line-comment" | "normal" | "string";

class SqlLiteralMasker {
  readonly #sql: string;
  #blockCommentDepth = 0;
  #index = 0;
  #output = "";
  #state: SqlMaskState = "normal";

  public constructor(sql: string) {
    this.#sql = sql;
  }

  public mask(): string {
    while (this.#index < this.#sql.length) {
      if (this.#state === "line-comment") this.#consumeLineComment();
      else if (this.#state === "block-comment") this.#consumeBlockComment();
      else if (this.#state === "string") this.#consumeString();
      else this.#consumeNormal();
    }
    return this.#output;
  }

  #consumeLineComment(): void {
    if (this.#current() === "\n") {
      this.#state = "normal";
      this.#append("\n");
      return;
    }
    this.#append(" ");
  }

  #consumeBlockComment(): void {
    if (this.#isPair("/", "*")) {
      this.#blockCommentDepth += 1;
      this.#appendPair();
      return;
    }
    if (this.#isPair("*", "/")) {
      this.#blockCommentDepth -= 1;
      if (this.#blockCommentDepth === 0) this.#state = "normal";
      this.#appendPair();
      return;
    }
    this.#appendMaskedCurrent();
  }

  #consumeString(): void {
    if (this.#isPair("'", "'")) {
      this.#appendPair();
      return;
    }
    if (this.#current() === "'") this.#state = "normal";
    this.#appendMaskedCurrent();
  }

  #consumeNormal(): void {
    if (this.#isPair("-", "-")) {
      this.#state = "line-comment";
      this.#appendPair();
      return;
    }
    if (this.#isPair("/", "*")) {
      this.#state = "block-comment";
      this.#blockCommentDepth = 1;
      this.#appendPair();
      return;
    }
    if (this.#current() === "'") {
      this.#state = "string";
      this.#append(" ");
      return;
    }
    this.#append(this.#current() ?? "");
  }

  #current(): string | undefined {
    return this.#sql[this.#index];
  }

  #isPair(current: string, next: string): boolean {
    return this.#current() === current && this.#sql[this.#index + 1] === next;
  }

  #append(value: string): void {
    this.#output += value;
    this.#index += 1;
  }

  #appendPair(): void {
    this.#output += "  ";
    this.#index += 2;
  }

  #appendMaskedCurrent(): void {
    this.#append(this.#current() === "\n" ? "\n" : " ");
  }
}
