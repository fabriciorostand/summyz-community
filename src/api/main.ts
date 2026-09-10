import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { Argon2InstallationPasswordHasher } from "../auth/argon2-installation-password-hasher.js";
import { DashboardSessionService } from "../auth/dashboard-session.js";
import { InstallationAccessRecoveryService } from "../auth/installation-access-recovery.js";
import { InstallationPasswordService } from "../auth/installation-password.js";
import { PostgresAiProfileStore } from "../database/postgres-ai-profile-store.js";
import { PostgresAnalyticsStore } from "../database/postgres-analytics-store.js";
import { PostgresDashboardSessionStore } from "../database/postgres-dashboard-session-store.js";
import { createPostgresDatabase } from "../database/postgres-database.js";
import { PostgresGuildConfigStore } from "../database/postgres-guild-config-store.js";
import { PostgresInstallationHealthStore } from "../database/postgres-installation-health-store.js";
import { PostgresInstallationAccessStore } from "../database/postgres-installation-access-store.js";
import { PostgresInstallationSettingsStore } from "../database/postgres-installation-settings-store.js";
import { PostgresLiveMeetingStore } from "../database/postgres-live-meeting-store.js";
import { PostgresParticipantDirectoryStore } from "../database/postgres-participant-directory-store.js";
import { PostgresTaskStore } from "../database/postgres-task-store.js";
import { DiscordRestGuildDirectory } from "../discord/discord-rest-guild-directory.js";
import { createLogger } from "../logger.js";
import { SecretBox } from "../security/secret-box.js";
import { createApiServer } from "./server.js";
import { loadWebConfig } from "./web-config.js";

if (existsSync(".env")) loadEnvFile(".env");

const config = loadWebConfig(process.env);
const logger = createLogger(config.logLevel);
const database = createPostgresDatabase(config.databaseUrl);
await database.initialize();

const secretBox = new SecretBox(config.secretsKey);
const settings = new PostgresInstallationSettingsStore({
  database,
  secretBox,
});
const auth = new DashboardSessionService({
  repository: new PostgresDashboardSessionStore(database),
});
const installationAccess = new PostgresInstallationAccessStore(database);
const passwordHasher = new Argon2InstallationPasswordHasher();
const passwords = new InstallationPasswordService({
  hasher: passwordHasher,
  repository: installationAccess,
});
const recovery = new InstallationAccessRecoveryService({
  hasher: passwordHasher,
  repository: installationAccess,
});
const guildDirectory = new DiscordRestGuildDirectory({
  fetch: globalThis.fetch,
  getBotToken: () => settings.getSecret("discord_bot_token"),
});
const app = await createApiServer(
  {
    accessMode: config.accessMode,
    analytics: new PostgresAnalyticsStore(database),
    aiProfiles: new PostgresAiProfileStore(database),
    auth,
    guildConfig: new PostgresGuildConfigStore(database),
    guildDirectory,
    health: new PostgresInstallationHealthStore(database),
    logger,
    liveMeetings: new PostgresLiveMeetingStore(database),
    participants: new PostgresParticipantDirectoryStore(database),
    passwords,
    publicBaseUrl: config.publicBaseUrl,
    recovery,
    settings,
    setupToken: config.setupToken,
    timeZone: config.summaryTimeZone,
    tasks: new PostgresTaskStore(database),
  },
  { staticDirectory: resolve(config.staticDirectory) },
);

await app.listen({ host: config.host, port: config.port });
logger.info({ host: config.host, port: config.port }, "Summyz dashboard started");

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Summyz dashboard shutdown requested");
  await app.close();
  await database.close();
  logger.info("Summyz dashboard stopped");
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
