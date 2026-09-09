import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { createOwnerRecoveryAuthorization } from "../auth/owner-recovery.js";
import { createPostgresDatabase } from "../database/postgres-database.js";
import { PostgresDiscordConnectionStore } from "../database/postgres-discord-connection-store.js";
import { PostgresInstallationSettingsStore } from "../database/postgres-installation-settings-store.js";
import { DiscordOAuthService } from "../discord/discord-oauth-service.js";
import { SecretBox } from "../security/secret-box.js";
import { loadWebConfig } from "./web-config.js";

if (existsSync(".env")) loadEnvFile(".env");

const config = loadWebConfig(process.env);
const database = createPostgresDatabase(config.databaseUrl);
try {
  await database.initialize();
  const secretBox = new SecretBox(config.secretsKey);
  const settings = new PostgresInstallationSettingsStore({
    database,
    publicBaseUrl: config.publicBaseUrl,
    secretBox,
  });
  const discord = new DiscordOAuthService({
    fetch: globalThis.fetch,
    repository: new PostgresDiscordConnectionStore({ database, secretBox }),
    settings,
  });
  const authorizationUrl = await createOwnerRecoveryAuthorization(discord);
  process.stdout.write(
    `Open this one-time Discord recovery URL within 10 minutes:\n${authorizationUrl}\n`,
  );
} finally {
  await database.close();
}
