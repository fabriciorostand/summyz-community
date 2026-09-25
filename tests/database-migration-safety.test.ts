import { describe, expect, it } from "vitest";

import {
  assertSafeDatabaseMigrations,
  databaseMigrationChecksum,
  UnsafeDatabaseMigrationError,
} from "../src/database/migration-safety.js";
import { databaseMigrations } from "../src/database/migrations.js";

describe("segurança das migrações do banco", () => {
  it("aceita todas as migrações protegidas do projeto", () => {
    expect(() => assertSafeDatabaseMigrations(databaseMigrations)).not.toThrow();
    expect(databaseMigrations.at(-1)).toMatchObject({ version: 14 });
    expect(databaseMigrations.find(({ version }) => version === 14)?.sql).toContain(
      "DROP CONSTRAINT ai_profiles_translation_check",
    );
    expect(databaseMigrations.find(({ version }) => version === 11)?.sql).toContain(
      "transcription_recovery_version",
    );
    expect(databaseMigrations.find(({ version }) => version === 11)?.sql).toContain(
      "artifacts_delete_after",
    );
    const authenticationFoundation = databaseMigrations.find(({ version }) => version === 4)?.sql;
    expect(authenticationFoundation).toContain("dashboard_theme");
    expect(authenticationFoundation).toContain("installation_access");
    expect(authenticationFoundation).toContain("installation_recovery_tokens");
    expect(authenticationFoundation).toContain("absolute_expires_at");
    expect(authenticationFoundation).not.toContain("owner_discord_user_id");
    expect(authenticationFoundation).not.toContain("discord_oauth");
    expect(authenticationFoundation).not.toContain("discord_client_secret");
    expect(authenticationFoundation).not.toContain("dashboard_users");
    expect(authenticationFoundation).not.toContain("smtp");
    const dashboardFoundation = databaseMigrations.find(({ version }) => version === 12)?.sql;
    expect(dashboardFoundation).toContain("meeting_tasks");
    expect(dashboardFoundation).toContain("live_meeting_states");
    expect(dashboardFoundation).toContain("runtime_component_heartbeats");
    expect(dashboardFoundation).not.toContain("ON DELETE CASCADE");
    expect(dashboardFoundation).toContain("OR completed_at IS NOT NULL");
    const recordingPermissions = databaseMigrations.find(({ version }) => version === 13)?.sql;
    expect(recordingPermissions).toContain("recording_user_grants");
    expect(recordingPermissions).not.toContain("ON DELETE CASCADE");
  });

  it.each([
    "DELETE FROM meetings WHERE pipeline_status = 'transcribing'",
    "TRUNCATE TABLE processing_jobs",
    "DROP TABLE meeting_contents",
    "ALTER TABLE meetings DROP COLUMN manifest",
    "DROP TABLE obsolete_meetings CASCADE",
    "UPDATE meetings SET manifest = NULL",
    "UPDATE processing_jobs SET status = 'failed'",
    "UPDATE provider_cost_attempts SET cost = 0",
    "UPDATE meeting_contents SET raw_transcript = ''",
    "UPDATE meeting_audio_segments SET relative_path = ''",
  ])("rejeita operação destrutiva: %s", (sql) => {
    expect(() => assertSafeDatabaseMigrations([{ sql, version: 10 }])).toThrow(
      UnsafeDatabaseMigrationError,
    );
  });

  it("não considera palavras em comentários ou valores textuais como comandos", () => {
    expect(() =>
      assertSafeDatabaseMigrations([
        {
          sql: `
-- DELETE FROM meetings
CREATE TABLE migration_notes (
  note text NOT NULL DEFAULT 'DROP TABLE meetings; DELETE FROM meetings'
);
`,
          version: 10,
        },
      ]),
    ).not.toThrow();
  });

  it("ignora comentários de bloco aninhados e aspas escapadas", () => {
    const migration = {
      sql: `
/* DROP TABLE meetings;
   /* DELETE FROM processing_jobs */
*/
CREATE TABLE migration_labels (
  label text NOT NULL DEFAULT 'don''t DELETE FROM meetings'
);
`,
      version: 10,
    };

    expect(() => assertSafeDatabaseMigrations([migration])).not.toThrow();
  });

  it("rejeita versões duplicadas, fora de ordem ou não inteiras", () => {
    expect(() =>
      assertSafeDatabaseMigrations([
        { sql: "CREATE TABLE first_table (id integer)", version: 10 },
        { sql: "CREATE TABLE second_table (id integer)", version: 10 },
      ]),
    ).toThrow(UnsafeDatabaseMigrationError);
    expect(() =>
      assertSafeDatabaseMigrations([
        { sql: "CREATE TABLE invalid_table (id integer)", version: 1.5 },
      ]),
    ).toThrow(UnsafeDatabaseMigrationError);
  });

  it("gera checksum estável que muda com a versão ou com o SQL", () => {
    const migration = { sql: "CREATE TABLE checksum_test (id integer)", version: 10 };

    expect(databaseMigrationChecksum(migration)).toHaveLength(64);
    expect(databaseMigrationChecksum(migration)).toBe(databaseMigrationChecksum(migration));
    expect(databaseMigrationChecksum({ ...migration, version: 11 })).not.toBe(
      databaseMigrationChecksum(migration),
    );
    expect(databaseMigrationChecksum({ ...migration, sql: `${migration.sql};` })).not.toBe(
      databaseMigrationChecksum(migration),
    );
  });

  it("mantém as migrações históricas anteriores à proteção como baseline", () => {
    expect(() =>
      assertSafeDatabaseMigrations([{ sql: "DELETE FROM legacy_table", version: 9 }]),
    ).not.toThrow();
  });
});
