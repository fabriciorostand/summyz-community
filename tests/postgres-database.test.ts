import { describe, expect, it, vi } from "vitest";
import { databaseMigrationChecksum } from "../src/database/migration-safety.js";
import { databaseMigrations } from "../src/database/migrations.js";
import {
  DatabaseInitializationError,
  PostgresDatabase,
  type PostgresPool,
} from "../src/database/postgres-database.js";

function createPool(
  options: {
    checksums?: Readonly<Record<number, string | null>>;
    failOn?: string;
    versions?: number[];
  } = {},
) {
  const queries: string[] = [];
  const query = vi.fn(async (text: string, _values?: readonly unknown[]) => {
    queries.push(text);
    if (options.failOn !== undefined && text.includes(options.failOn)) {
      throw new Error("postgresql://summyz:segredo@localhost/summyz");
    }
    if (text.includes("SELECT version, checksum FROM schema_migrations")) {
      return {
        rowCount: options.versions?.length ?? 0,
        rows:
          options.versions?.map((version) => ({
            checksum: options.checksums?.[version] ?? null,
            version,
          })) ?? [],
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

function getFirstMigration() {
  const migration = databaseMigrations[0];
  if (migration === undefined) throw new Error("Expected at least one database migration");
  return migration;
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
    expect(queries.some((query) => query.includes("CREATE TABLE dashboard_users"))).toBe(false);
    expect(queries.some((query) => query.includes("CREATE TABLE dashboard_sessions"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE installation_access"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE installation_secrets"))).toBe(true);
    expect(
      queries.some((query) => query.includes("CREATE TABLE installation_recovery_tokens")),
    ).toBe(true);
    expect(queries.some((query) => query.includes("persist_meeting_content boolean"))).toBe(true);
    expect(queries.some((query) => query.includes("bot_language text"))).toBe(true);
    expect(queries.some((query) => query.includes("owner_discord_user_id text"))).toBe(false);
    expect(queries.some((query) => query.includes("profile_type text"))).toBe(true);
    expect(queries.some((query) => query.includes("discord_client_secret"))).toBe(true);
    expect(queries.some((query) => query.includes("CREATE TABLE installation_oauth_states"))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes("CREATE TABLE guild_owner_approvals"))).toBe(
      true,
    );
    expect(
      queries.some((query) =>
        query.includes("meetings_storage_mode_check CHECK (storage_mode = 'postgres')"),
      ),
    ).toBe(true);
    expect(
      queries.some((query) => query.includes("guild_configurations_active_ai_profile_fk")),
    ).toBe(true);
    expect(queries.some((query) => query.includes("checksum text"))).toBe(true);
    expect(
      client.query.mock.calls.some(
        ([query, values]) =>
          query.includes("INSERT INTO schema_migrations (version, checksum)") &&
          Array.isArray(values) &&
          typeof values[1] === "string" &&
          values[1].length === 64,
      ),
    ).toBe(true);
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

  it("registra automaticamente o checksum baseline de migrations antigas", async () => {
    const migration = getFirstMigration();
    const { client, pool } = createPool({ versions: [migration.version] });

    await new PostgresDatabase(pool).initialize();

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE schema_migrations SET checksum = $2"),
      [migration.version, databaseMigrationChecksum(migration)],
    );
  });

  it("não reaplica nem altera migration com checksum válido", async () => {
    const migration = getFirstMigration();
    const checksum = databaseMigrationChecksum(migration);
    const { client, pool, queries } = createPool({
      checksums: { [migration.version]: checksum },
      versions: [migration.version],
    });

    await new PostgresDatabase(pool).initialize();

    expect(queries.some((query) => query.includes("CREATE TABLE meetings"))).toBe(false);
    expect(
      client.query.mock.calls.some(([query]) =>
        query.includes("UPDATE schema_migrations SET checksum = $2"),
      ),
    ).toBe(false);
  });

  it("interrompe a inicialização quando uma migration aplicada foi alterada", async () => {
    const migration = getFirstMigration();
    const { client, pool, queries } = createPool({
      checksums: { [migration.version]: "0".repeat(64) },
      versions: [migration.version],
    });

    await expect(new PostgresDatabase(pool).initialize()).rejects.toBeInstanceOf(
      DatabaseInitializationError,
    );

    expect(queries).toContain("ROLLBACK");
    expect(queries.some((query) => query.includes("CREATE TABLE meetings"))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("normaliza perfis para auto sem descartar reuniões em processamento", async () => {
    const { pool, queries } = createPool({ versions: [1, 2, 3, 4, 5, 6, 7, 8, 9] });

    await new PostgresDatabase(pool).initialize();

    const sql = queries.join("\n");
    expect(sql).toMatch(/ADD COLUMN language text NOT NULL DEFAULT 'auto'/i);
    expect(sql).toMatch(/ADD COLUMN translation jsonb/i);
    expect(sql).toMatch(/UPDATE ai_profiles[\s\S]*language = 'auto'/i);
    expect(sql).not.toMatch(/delivery_2_meeting_cleanup/i);
    expect(sql).not.toMatch(/DELETE FROM meetings/i);
    expect(sql).not.toMatch(/DELETE FROM processing_jobs/i);
    expect(sql).not.toMatch(/DELETE FROM provider_cost_attempts/i);
  });

  it("normaliza configurações v1 que já foram marcadas como manifesto v3", async () => {
    const { pool, queries } = createPool({ versions: [1, 2, 3, 4, 5, 6, 7] });
    const database = new PostgresDatabase(pool);

    await database.initialize();

    const correctiveMigration = queries.find((query) =>
      query.includes("'{aiConfiguration,profileType}'"),
    );
    expect(correctiveMigration).toContain("'{storageMode}'");
    expect(correctiveMigration).toContain("'{aiConfiguration,transcription,batchSize}'");
    expect(correctiveMigration).toContain("meeting_contents");
  });

  it("normaliza todos os prompts ausentes antes de exigir o contrato atual dos perfis", async () => {
    const { pool, queries } = createPool({ versions: [1, 2, 3, 4, 5, 6, 7, 8] });
    const database = new PostgresDatabase(pool);

    await database.initialize();

    const correctiveMigration = queries.find((query) =>
      query.includes("ai_profiles_prompt_contract_check"),
    );
    expect(correctiveMigration).toContain("transcription ? 'prompt'");
    expect(correctiveMigration).toContain("refinement ? 'prompt'");
    expect(correctiveMigration).toContain("summary ? 'extractionPrompt'");
    expect(correctiveMigration).toContain("summary ? 'consolidationPrompt'");
    expect(correctiveMigration).toContain("dashboard_language");
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
