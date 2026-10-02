import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { Argon2InstallationPasswordHasher } from "../auth/argon2-installation-password-hasher.js";
import { InstallationAccessRecoveryService } from "../auth/installation-access-recovery.js";
import { createPostgresDatabase } from "../database/postgres-database.js";
import { PostgresInstallationAccessStore } from "../database/postgres-installation-access-store.js";
import { loadWebConfig } from "./web-config.js";

if (existsSync(".env")) loadEnvFile(".env");

const config = loadWebConfig(process.env, process.argv.slice(2));
if (config.accessMode !== "public") {
  throw new Error("Installation password recovery is available only in public access mode");
}

const database = createPostgresDatabase(config.databaseUrl);
try {
  await database.initialize();
  const recovery = new InstallationAccessRecoveryService({
    hasher: new Argon2InstallationPasswordHasher(),
    repository: new PostgresInstallationAccessStore(database),
  });
  const token = await recovery.create();
  const url = new URL("/recover", config.publicBaseUrl);
  url.hash = `token=${encodeURIComponent(token)}`;
  process.stdout.write(`Open this one-time recovery URL within 10 minutes:\n${url.toString()}\n`);
} finally {
  await database.close();
}
