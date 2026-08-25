import { Pool, type PoolClient, type QueryResultRow } from "pg";

import { databaseMigrations } from "./migrations.js";

export interface PostgresQueryResult {
  rowCount: number | null;
  rows: Record<string, unknown>[];
}

export interface PostgresExecutor {
  query(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult>;
}

export interface PostgresClient extends PostgresExecutor {
  release(): void;
}

export interface PostgresPool extends PostgresExecutor {
  connect(): Promise<PostgresClient>;
  end(): Promise<void>;
}

export class DatabaseInitializationError extends Error {
  public constructor() {
    super("Não foi possível inicializar o PostgreSQL");
    this.name = "DatabaseInitializationError";
  }
}

export class PostgresDatabase implements PostgresExecutor {
  readonly #pool: PostgresPool;

  public constructor(pool: PostgresPool) {
    this.#pool = pool;
  }

  public async initialize(): Promise<void> {
    const client = await this.#connectSafely();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('summyz_schema_migrations'))");
      await client.query(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`);
      const applied = await client.query("SELECT version FROM schema_migrations ORDER BY version");
      const versions = new Set(
        applied.rows
          .map((row) => row.version)
          .filter((version): version is number => typeof version === "number"),
      );
      for (const migration of databaseMigrations) {
        if (!versions.has(migration.version)) {
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [
            migration.version,
          ]);
        }
      }
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new DatabaseInitializationError();
    } finally {
      client.release();
    }
  }

  public async query(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult> {
    return this.#pool.query(text, values);
  }

  public async close(): Promise<void> {
    await this.#pool.end();
  }

  async #connectSafely(): Promise<PostgresClient> {
    try {
      return await this.#pool.connect();
    } catch {
      throw new DatabaseInitializationError();
    }
  }
}

export function createPostgresDatabase(connectionString: string): PostgresDatabase {
  const pool = new Pool({
    allowExitOnIdle: true,
    application_name: "summyz",
    connectionString,
    max: 5,
  });
  return new PostgresDatabase(createPoolAdapter(pool));
}

function createPoolAdapter(pool: Pool): PostgresPool {
  return {
    connect: async () => createClientAdapter(await pool.connect()),
    end: async () => pool.end(),
    query: async (text, values) =>
      toQueryResult(await pool.query<QueryResultRow>(text, [...(values ?? [])])),
  };
}

function createClientAdapter(client: PoolClient): PostgresClient {
  return {
    query: async (text, values) =>
      toQueryResult(await client.query<QueryResultRow>(text, [...(values ?? [])])),
    release: () => client.release(),
  };
}

function toQueryResult(result: {
  rowCount: number | null;
  rows: QueryResultRow[];
}): PostgresQueryResult {
  return { rowCount: result.rowCount, rows: result.rows };
}
