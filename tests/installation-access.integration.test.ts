import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { Argon2InstallationPasswordHasher } from "../src/auth/argon2-installation-password-hasher.js";
import { DashboardSessionError, DashboardSessionService } from "../src/auth/dashboard-session.js";
import {
  InstallationAccessRecoveryError,
  InstallationAccessRecoveryService,
} from "../src/auth/installation-access-recovery.js";
import { InstallationPasswordService } from "../src/auth/installation-password.js";
import { PostgresDashboardSessionStore } from "../src/database/postgres-dashboard-session-store.js";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresInstallationAccessStore } from "../src/database/postgres-installation-access-store.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("installation access in real PostgreSQL", () => {
  it("atomically replaces the password and revokes sessions on change and recovery", async () => {
    const admin = new Pool({ connectionString: connectionString ?? "postgresql://invalid" });
    const schemaName = `installation_access_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const database = createPostgresDatabase(withSearchPath(connectionString, schemaName));

    try {
      await database.initialize();
      const repository = new PostgresInstallationAccessStore(database);
      const hasher = new Argon2InstallationPasswordHasher();
      const passwords = new InstallationPasswordService({ hasher, repository });
      const recovery = new InstallationAccessRecoveryService({ hasher, repository });
      const sessions = new DashboardSessionService({
        repository: new PostgresDashboardSessionStore(database),
      });

      await passwords.initialize("primeira frase secreta segura");
      const firstSession = await sessions.create();
      await expect(sessions.authenticate(firstSession)).resolves.toMatchObject({
        dashboardLanguage: "pt-BR",
      });

      await passwords.change("primeira frase secreta segura", "segunda frase secreta segura");
      await expect(sessions.authenticate(firstSession)).rejects.toBeInstanceOf(
        DashboardSessionError,
      );
      await expect(passwords.authenticate("segunda frase secreta segura")).resolves.toBeUndefined();

      const recoveryToken = await recovery.create();
      const secondSession = await sessions.create();
      await recovery.recover(recoveryToken, "terceira frase secreta segura");
      await expect(sessions.authenticate(secondSession)).rejects.toBeInstanceOf(
        DashboardSessionError,
      );
      await expect(
        recovery.recover(recoveryToken, "quarta frase secreta segura"),
      ).rejects.toBeInstanceOf(InstallationAccessRecoveryError);
    } finally {
      await database.close();
      await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.end();
    }
  });
});

function withSearchPath(url: string | undefined, schemaName: string): string {
  const parsed = new URL(url ?? "postgresql://invalid");
  parsed.searchParams.set("options", `-c search_path=${schemaName}`);
  return parsed.toString();
}
