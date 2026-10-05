import "../runtime-platform.js";
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
import { PostgresGuildHistoryStore } from "../database/postgres-guild-history-store.js";
import { PostgresGuildOwnerApprovalStore } from "../database/postgres-guild-owner-approval-store.js";
import { PostgresInstallationAccessStore } from "../database/postgres-installation-access-store.js";
import { PostgresInstallationDiscordConnectionStore } from "../database/postgres-installation-discord-connection-store.js";
import { PostgresInstallationHealthStore } from "../database/postgres-installation-health-store.js";
import { PostgresInstallationSettingsStore } from "../database/postgres-installation-settings-store.js";
import { PostgresLiveMeetingStore } from "../database/postgres-live-meeting-store.js";
import { PostgresModelCatalogStore } from "../database/postgres-model-catalog-store.js";
import { PostgresModelDownloadStore } from "../database/postgres-model-download-store.js";
import { PostgresParticipantDirectoryStore } from "../database/postgres-participant-directory-store.js";
import { PostgresTaskStore } from "../database/postgres-task-store.js";
import { createDiscordApiFetch } from "../discord/discord-api-fetch.js";
import { DiscordRestGuildDirectory } from "../discord/discord-rest-guild-directory.js";
import { InstallationDiscordConnection } from "../discord/installation-discord-connection.js";
import { readGpuServiceAvailability } from "../local-ai/gpu-service-availability.js";
import { detectLocalHardware } from "../local-ai/hardware-detection.js";
import { createLogger } from "../logger.js";
import { LocalModelInventory } from "../models/local-model-inventory.js";
import { CachedModelCatalog } from "../models/model-catalog.js";
import { ModelCatalogService } from "../models/model-catalog-service.js";
import { ModelDownloadManager } from "../models/model-download-manager.js";
import { ModelManagement } from "../models/model-management.js";
import { ProviderModelTransfer } from "../models/model-transfer.js";
import { SecretBox } from "../security/secret-box.js";
import { createApiServer } from "./server.js";
import { loadWebConfig } from "./web-config.js";

if (existsSync(".env")) loadEnvFile(".env");

const config = loadWebConfig(process.env, process.argv.slice(2));
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
const discordFetch = createDiscordApiFetch(globalThis.fetch, (event) => {
  logger.warn(event, "Discord API rate limited");
});
const guildDirectory = new DiscordRestGuildDirectory({
  fetch: discordFetch,
  getBotToken: () => settings.getSecret("discord_bot_token"),
});
const discordConnection = new InstallationDiscordConnection({
  applicationId: async () => (await settings.getSettings()).discordApplicationId,
  clientSecret: () => settings.getSecret("discord_client_secret"),
  fetch: discordFetch,
  logger,
  publicBaseUrl: config.publicBaseUrl,
  repository: new PostgresInstallationDiscordConnectionStore(database, secretBox),
});
const initialHardware = await detectLocalHardware();
const readHardware = () => readGpuServiceAvailability(initialHardware);
const inventory = new LocalModelInventory(globalThis.fetch, readHardware);
const catalog = new ModelCatalogService(
  new CachedModelCatalog(new PostgresModelCatalogStore(database)),
  inventory,
  readHardware,
  () => settings.getSecret("openrouter_api_key"),
  globalThis.fetch,
);
const downloads = new ModelDownloadManager(
  new PostgresModelDownloadStore(database),
  new ProviderModelTransfer(),
  logger,
);
const models = {
  inventory,
  catalog,
  management: new ModelManagement(database, catalog, downloads),
};
const app = await createApiServer(
  {
    accessMode: config.accessMode,
    hardware: { readHardware },
    models,
    analytics: new PostgresAnalyticsStore(database),
    aiProfiles: new PostgresAiProfileStore(database),
    auth,
    discordConnection,
    guildConfig: new PostgresGuildConfigStore(database),
    guildDirectory,
    guildHistory: new PostgresGuildHistoryStore(database),
    guildOwnerApprovals: new PostgresGuildOwnerApprovalStore(database),
    health: new PostgresInstallationHealthStore(database),
    logger,
    liveMeetings: new PostgresLiveMeetingStore(database),
    participants: new PostgresParticipantDirectoryStore(database),
    passwords,
    publicBaseUrl: config.publicBaseUrl,
    recovery,
    settings,
    setupToken: config.setupToken,
    tasks: new PostgresTaskStore(database),
  },
  { staticDirectory: resolve(config.staticDirectory) },
);

await app.listen({ host: config.host, port: config.port });
downloads.start();
logger.info({ host: config.host, port: config.port }, "Summyz dashboard started");

let stopping = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Summyz dashboard shutdown requested");
  await app.close();
  await downloads.shutdown();
  await database.close();
  logger.info("Summyz dashboard stopped");
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
