import "summyz-community-shared/runtime-platform";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { PostgresCostLedgerStore } from "summyz-community-shared/cost/postgres-cost-ledger-store";
import { PostgresAiProfileStore } from "summyz-community-shared/database/postgres-ai-profile-store";
import { PostgresAnalyticsStore } from "summyz-community-shared/database/postgres-analytics-store";
import { PostgresDashboardSessionStore } from "summyz-community-shared/database/postgres-dashboard-session-store";
import { createPostgresDatabase } from "summyz-community-shared/database/postgres-database";
import { PostgresGuildConfigStore } from "summyz-community-shared/database/postgres-guild-config-store";
import { PostgresGuildHistoryStore } from "summyz-community-shared/database/postgres-guild-history-store";
import { PostgresGuildOwnerApprovalStore } from "summyz-community-shared/database/postgres-guild-owner-approval-store";
import { PostgresInstallationAccessStore } from "summyz-community-shared/database/postgres-installation-access-store";
import { PostgresInstallationDiscordConnectionStore } from "summyz-community-shared/database/postgres-installation-discord-connection-store";
import { PostgresInstallationHealthStore } from "summyz-community-shared/database/postgres-installation-health-store";
import { PostgresInstallationSettingsStore } from "summyz-community-shared/database/postgres-installation-settings-store";
import { PostgresLiveMeetingStore } from "summyz-community-shared/database/postgres-live-meeting-store";
import { PostgresModelCatalogStore } from "summyz-community-shared/database/postgres-model-catalog-store";
import { PostgresModelDownloadStore } from "summyz-community-shared/database/postgres-model-download-store";
import { PostgresParticipantDirectoryStore } from "summyz-community-shared/database/postgres-participant-directory-store";
import { PostgresTaskStore } from "summyz-community-shared/database/postgres-task-store";
import { createDiscordApiFetch } from "summyz-community-shared/discord/discord-api-fetch";
import { InstallationDiscordConnection } from "summyz-community-shared/discord/installation-discord-connection";
import { readGpuServiceAvailability } from "summyz-community-shared/local-ai/gpu-service-availability";
import { detectLocalHardware } from "summyz-community-shared/local-ai/hardware-detection";
import { createLogger } from "summyz-community-shared/logger";
import { LocalModelInventory } from "summyz-community-shared/models/local-model-inventory";
import { CachedModelCatalog } from "summyz-community-shared/models/model-catalog";
import { ModelDownloadManager } from "summyz-community-shared/models/model-download-manager";
import { SecretBox } from "summyz-community-shared/security/secret-box";
import { Argon2InstallationPasswordHasher } from "./auth/argon2-installation-password-hasher.js";
import { DashboardSessionService } from "./auth/dashboard-session.js";
import { InstallationAccessRecoveryService } from "./auth/installation-access-recovery.js";
import { InstallationPasswordService } from "./auth/installation-password.js";
import { CostReconciler } from "./cost/cost-reconciler.js";
import { loadDashboardConfig } from "./dashboard-config.js";
import { DiscordRestGuildDirectory } from "./discord/discord-rest-guild-directory.js";
import { ModelCatalogService } from "./models/model-catalog-service.js";
import { ModelManagement } from "./models/model-management.js";
import { ProviderModelTransfer } from "./models/model-transfer.js";
import { createApiServer } from "./server.js";

if (existsSync(".env")) loadEnvFile(".env");

const config = loadDashboardConfig(process.env, process.argv.slice(2));
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
const costLedger = new PostgresCostLedgerStore(database);
const costReconciliation = new CostReconciler({
  apiKey: () => settings.getSecret("openrouter_api_key"),
  logger,
  store: costLedger,
});
const app = await createApiServer(
  {
    accessMode: config.accessMode,
    hardware: { readHardware },
    models,
    analytics: new PostgresAnalyticsStore(database),
    aiProfiles: new PostgresAiProfileStore(database),
    auth,
    costReconciliation,
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
