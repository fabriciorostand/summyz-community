import { describe, expect, it, vi } from "vitest";

import {
  DatabaseInitializationError,
  PostgresDatabase,
  type PostgresPool,
} from "../src/database/postgres-database.js";

function createPool(options: { failOn?: string; versions?: number[] } = {}) {
  const queries: string[] = [];
  const query = vi.fn(async (text: string) => {
    queries.push(text);
    if (options.failOn !== undefined && text.includes(options.failOn)) {
      throw new Error("postgresql://summyz:segredo@localhost/summyz");
    }
    if (text.includes("SELECT version FROM schema_migrations")) {
      return {
        rowCount: options.versions?.length ?? 0,
        rows: options.versions?.map((version) => ({ version })) ?? [],
      };
    }
    return { rowCount: 0, rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool: PostgresPool = {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    query,
  };
  return { client, pool, queries };
}

describe("PostgresDatabase", () => {
  it("aplica migrations pendentes em uma transação protegida", async () => {
    const { client, pool, queries } = createPool();
    const database = new PostgresDatabase(pool);

    await database.initialize();

    expect(queries[0]).toBe("BEGIN");
    expect(queries).toContain("SELECT pg_advisory_xact_lock(hashtext('summyz_schema_migrations'))");
    expect(queries.some((query) => query.includes("CREATE TABLE meetings"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE processing_jobs"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE meeting_contents"))).toBe(true);
    expect(queries.some((query) => query.includes("persist_audio boolean"))).toBe(true);
    expect(queries.some((query) => query.includes("storage_mode text"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE provider_cost_attempts"))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes("CREATE TABLE ai_profiles"))).toBe(true);
    expect(queries.some((query) => query.includes("active_ai_profile_id"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE dashboard_users"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE dashboard_sessions"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE discord_connections"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE installation_secrets"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE discord_oauth_states"))).toBe(true);
    expect(queries.some((query) => query.includes("persist_meeting_content boolean"))).toBe(true);
    expect(queries.some((query) => query.includes("bot_language text"))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("não reaplica uma migration já registrada", async () => {
    const { pool, queries } = createPool({ versions: [1] });
    const database = new PostgresDatabase(pool);

    await database.initialize();

    expect(queries.some((query) => query.includes("CREATE TABLE meetings"))).toBe(false);
    expect(queries.some((query) => query.includes("CREATE TABLE provider_cost_attempts"))).toBe(
      true,
    );
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("faz rollback e expõe somente um erro seguro quando o PostgreSQL falha", async () => {
    const { client, pool, queries } = createPool({ failOn: "CREATE TABLE meetings" });
    const database = new PostgresDatabase(pool);

    await expect(database.initialize()).rejects.toEqual(
      expect.objectContaining({
        message: "Não foi possível inicializar o PostgreSQL",
        name: "DatabaseInitializationError",
      }),
    );

    expect(queries).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledOnce();
    await expect(database.initialize()).rejects.toBeInstanceOf(DatabaseInitializationError);
  });

  it("encerra o pool de conexões", async () => {
    const { pool } = createPool();
    const database = new PostgresDatabase(pool);

    await database.close();

    expect(pool.end).toHaveBeenCalledOnce();
  });

  it("converte uma conexão recusada em erro seguro", async () => {
    const { pool } = createPool();
    pool.connect = vi.fn(async () => {
      throw new Error("postgresql://summyz:segredo@localhost/summyz");
    });
    const database = new PostgresDatabase(pool);

    await expect(database.initialize()).rejects.toEqual(
      expect.objectContaining({
        message: "Não foi possível inicializar o PostgreSQL",
        name: "DatabaseInitializationError",
      }),
    );
  });
});
