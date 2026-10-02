import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

import { AuditLogEvent, Client, Events, GatewayIntentBits } from "discord.js";

import { ApplicationAiRuntime } from "./application-ai-runtime.js";
import { waitForBotConfiguration } from "./bot-bootstrap.js";
import { BotConfigurationMonitor } from "./bot-configuration-monitor.js";
import { createBotProcessingRuntime } from "./bot-processing-runtime.js";
import { reconcilePendingRecordings } from "./bot-recording-recovery.js";
import { BOT_CONFIGURATION_RESTART_EXIT_CODE } from "./bot-supervisor.js";
import { loadConfig, resolveBotConfig } from "./config.js";
import { CostReconciler } from "./cost/cost-reconciler.js";
import { createCostReportService } from "./cost/cost-report.js";
import { PostgresCostLedgerStore } from "./cost/postgres-cost-ledger-store.js";
import { PostgresAiProfileStore } from "./database/postgres-ai-profile-store.js";
import { createPostgresDatabase, type PostgresDatabase } from "./database/postgres-database.js";
import { PostgresGuildConfigStore } from "./database/postgres-guild-config-store.js";
import { PostgresGuildHistoryStore } from "./database/postgres-guild-history-store.js";
import { PostgresGuildOwnerApprovalStore } from "./database/postgres-guild-owner-approval-store.js";
import { PostgresHardwareStore } from "./database/postgres-hardware-store.js";
import { PostgresInstallationDiscordConnectionStore } from "./database/postgres-installation-discord-connection-store.js";
import { PostgresInstallationHealthStore } from "./database/postgres-installation-health-store.js";
import { PostgresInstallationSettingsStore } from "./database/postgres-installation-settings-store.js";
import { PostgresLiveMeetingStore } from "./database/postgres-live-meeting-store.js";
import { PostgresMeetingStore } from "./database/postgres-meeting-store.js";
import { PostgresModelCatalogStore } from "./database/postgres-model-catalog-store.js";
import {
  BotPermissionMonitor,
  createDiscordBotPermissionReader,
} from "./discord/bot-permissions.js";
import { GuildDepartureHandler } from "./discord/guild-departure-handler.js";
import { GuildMembershipVerifier } from "./discord/guild-membership-verifier.js";
import { GuildOwnerVerifier } from "./discord/guild-owner-verifier.js";
import {
  type GuildAccessResult,
  installGuildOwnershipHandler,
} from "./discord/guild-ownership-handler.js";
import { installInteractionHandler } from "./discord/interaction-handler.js";
import { registerCommands } from "./discord/register-commands.js";
import { VoiceChannelDeletionVerifier } from "./discord/voice-channel-deletion-verifier.js";
import { installVoiceStateHandler } from "./discord/voice-state-handler.js";
import { readGpuServiceAvailability } from "./local-ai/gpu-service-availability.js";
import { detectLocalHardware } from "./local-ai/hardware-detection.js";
import { limitHardwareResources } from "./local-ai/hardware-profile.js";
import { createLogger } from "./logger.js";
import { validateFfmpegExecutable } from "./media/ffmpeg-executable.js";
import { CachedModelCatalog } from "./models/model-catalog.js";
import { lockModelLifecycle } from "./models/model-lifecycle-lock.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import type { RecordingManifest } from "./recording/manifest.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";
import { RefinementStore } from "./refinement/refinement-store.js";
import { SecretBox } from "./security/secret-box.js";
import { PublicationStore } from "./summary/publication-store.js";
import { SummaryStore } from "./summary/summary-store.js";
import { configureTerminalEncoding } from "./terminal-encoding.js";
import { TranscriptionStore } from "./transcription/transcription-store.js";

const terminalEncoding = configureTerminalEncoding();

if (existsSync(".env")) {
  loadEnvFile(".env");
}

let bootstrapConfig: ReturnType<typeof loadConfig>;
try {
  bootstrapConfig = loadConfig(process.env);
} catch {
  console.error("Invalid configuration. Review .env.");
  process.exitCode = 1;
  throw new Error("Invalid configuration");
}

const logger = createLogger(bootstrapConfig.logLevel);
if (!terminalEncoding.configured) {
  logger.warn(
    { errorType: terminalEncoding.errorType },
    "Unable to configure the Windows terminal for UTF-8",
  );
}

try {
  await validateFfmpegExecutable();
  logger.info("FFmpeg executable and libopus encoder validated");
} catch (error: unknown) {
  logger.fatal({ errorType: getErrorType(error) }, "FFmpeg preflight failed");
  process.exitCode = 1;
  throw error;
}

const database: PostgresDatabase = createPostgresDatabase(bootstrapConfig.databaseUrl);
try {
  await database.initialize();
  logger.info("PostgreSQL initialized");
} catch (error) {
  logger.fatal(
    { errorType: getErrorType(error) },
    "Unable to initialize PostgreSQL; check DATABASE_URL and database availability",
  );
  await database.close().catch(() => undefined);
  process.exit(1);
}

const installationSettings = new PostgresInstallationSettingsStore({
  database,
  secretBox: new SecretBox(bootstrapConfig.secretsKey),
});
const installationHealth = new PostgresInstallationHealthStore(database);
const previousBotHeartbeatAt = await installationHealth
  .getHeartbeatAt("bot-main")
  .catch((error: unknown) => {
    logger.warn({ errorType: getErrorType(error) }, "Unable to read previous bot heartbeat");
    return undefined;
  });
logger.info("Waiting for dashboard setup before connecting to Discord");
const storedBotConfiguration = await waitForBotConfiguration({
  read: () => installationSettings.getBotConfigurationSnapshot(),
});
const config: ReturnType<typeof resolveBotConfig> = resolveBotConfig(
  bootstrapConfig,
  storedBotConfiguration,
);

const localHardware = await detectLocalHardware();
const hardwareStore = new PostgresHardwareStore(database);
const recordingsDirectory = join(config.dataDir, "recordings");

const postgresMeetingStore = new PostgresMeetingStore(database, storedBotConfiguration.version);
const guildHistoryStore = new PostgresGuildHistoryStore(database);
const manifestStore = new ManifestStore(recordingsDirectory, postgresMeetingStore);
const transcriptionStore = new TranscriptionStore(recordingsDirectory);
const migratedManifestCount = await manifestStore.migrateLegacyManifests();
if (migratedManifestCount > 0) {
  logger.info({ migratedManifestCount }, "Legacy recording manifests migrated");
}
const postgresCostLedger = new PostgresCostLedgerStore(database);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
const permissionMonitor = new BotPermissionMonitor(
  createDiscordBotPermissionReader(client),
  logger,
);
client.on(Events.GuildCreate, (guild) => {
  if (client.isReady()) void permissionMonitor.checkGuild(guild.id);
});
const membershipVerifier = new GuildMembershipVerifier(
  (guildId) => client.guilds.fetch({ guild: guildId, force: true }),
  logger,
);
const guildConfigStore = new PostgresGuildConfigStore(database);
const ownerApprovals = new PostgresGuildOwnerApprovalStore(database);
const discordConnectionStore = new PostgresInstallationDiscordConnectionStore(
  database,
  new SecretBox(bootstrapConfig.secretsKey),
);
const aiProfileStore = new PostgresAiProfileStore(database);
const liveMeetingStore = new PostgresLiveMeetingStore(database);
const aiRuntime = new ApplicationAiRuntime({
  modelCatalogCache: new CachedModelCatalog(new PostgresModelCatalogStore(database)),
  aiProfileStore,
  client,
  config,
  costStore: postgresCostLedger,
  hardware: localHardware,
  readHardware: async () =>
    readGpuServiceAvailability(
      limitHardwareResources((await hardwareStore.read())?.hardware ?? localHardware),
    ),
  installationSettings,
  installationHealth,
  logger,
});
const costReport = createCostReportService({
  language: config.botLanguage,
  reconcile: async (guildId) => {
    const apiKey = await aiRuntime.resolveOpenRouterApiKey();
    if (apiKey === undefined) return;
    await new CostReconciler({ apiKey, logger, store: postgresCostLedger }).reconcile(guildId);
  },
  store: postgresCostLedger,
  timeZone: config.summaryTimeZone,
});
const refinementStore = new RefinementStore(recordingsDirectory);
const summaryStore = new SummaryStore(recordingsDirectory);
const publicationStore = new PublicationStore(recordingsDirectory);
const guildOwnerVerifier = new GuildOwnerVerifier(
  async (guildId) => (await client.guilds.fetch({ guild: guildId, force: true })).ownerId,
  (guildId, ownerId) => ownerApprovals.isConfirmed(guildId, ownerId),
  logger,
  5_000,
);
const voiceChannelDeletionVerifier = new VoiceChannelDeletionVerifier(
  (channelId) => client.channels.fetch(channelId, { force: true }),
  async (guildId, channelId, startedAt) => {
    const guild = await client.guilds.fetch({ guild: guildId, force: true });
    let auditLogs: Awaited<ReturnType<typeof guild.fetchAuditLogs>>;
    try {
      auditLogs = await guild.fetchAuditLogs({ limit: 100, type: AuditLogEvent.ChannelDelete });
    } catch (error) {
      await permissionMonitor.checkGuild(guildId);
      throw error;
    }
    return auditLogs.entries.some(
      (entry) => entry.targetId === channelId && entry.createdTimestamp >= Date.parse(startedAt),
    );
  },
  logger,
  5_000,
);
client.on(Events.ChannelDelete, (channel) => {
  if ("guildId" in channel && typeof channel.guildId === "string") {
    voiceChannelDeletionVerifier.noteDeletion(channel.guildId, channel.id);
  }
});
async function checkGuildAccess(guildId: string): Promise<GuildAccessResult> {
  let connectedUserId: string | undefined;
  try {
    connectedUserId = (await discordConnectionStore.getConnection())?.discordUserId;
  } catch (error) {
    logger.warn(
      { errorType: getErrorType(error), guildId },
      "Unable to read linked Discord account for guild access check",
    );
    return { status: "unknown" };
  }
  if (connectedUserId === undefined) return { status: "denied" };
  return guildOwnerVerifier.check(guildId, connectedUserId);
}
const { artifactMaintenance, postgresQueue, processingHandler, worker } =
  createBotProcessingRuntime({
    aiRuntime,
    client,
    config,
    database,
    guildConfigStore,
    logger,
    onPublicationFailure: (guildId, forumId) =>
      permissionMonitor.checkPublication(guildId, forumId),
    manifestStore,
    membershipVerifier,
    postgresMeetingStore,
    publicationStore,
    refinementStore,
    summaryStore,
    transcriptionStore,
  });
async function enqueueCompleted(manifest: RecordingManifest): Promise<void> {
  await postgresCostLedger.saveMeeting(manifest);
  await postgresQueue.enqueue(manifest.meetingId, "transcription");
}

const recordingFactory = new DiscordRecordingFactory(
  client,
  config,
  manifestStore,
  logger,
  enqueueCompleted,
  (guildId) => aiRuntime.resolveAndPrepareMeetingProfile(guildId),
  (guildId) => guildConfigStore.getGuildSettings(guildId),
  liveMeetingStore,
);
const coordinator = new RecordingCoordinator({
  create: (input, onEnded) =>
    database.transaction(async (executor) => {
      await lockModelLifecycle(executor);
      if (input.guildName !== undefined) {
        await new PostgresGuildHistoryStore(executor).remember(
          input.guildId,
          input.guildName,
          input.guildIconUrl ?? null,
        );
      }
      return recordingFactory.create(input, onEnded);
    }),
  resume: (manifest, onEnded) => recordingFactory.resume(manifest, onEnded),
});
const departureHandler = new GuildDepartureHandler({
  cancelPending: (guildId) => guildHistoryStore.cancelPending(guildId),
  cleanup: (meetingId) => processingHandler.cleanup(meetingId),
  logger,
  stop: (guildId, request) => coordinator.stop(guildId, request),
});

const recoveryOptions = {
  checkGuildAccess,
  coordinator,
  departureHandler,
  guildOwnerVerifier,
  logger,
  manifestStore,
  membershipVerifier,
  postgresMeetingStore,
  previousBotHeartbeatAt,
  recordingFactory,
  voiceChannelDeletionVerifier,
};
const recoverPendingRecordings = () => reconcilePendingRecordings(recoveryOptions);
installInteractionHandler(
  client,
  guildConfigStore,
  coordinator,
  logger,
  config.botLanguage,
  costReport,
  aiProfileStore,
  (guildId) => aiRuntime.assessActiveProfile(guildId),
  async () => (await aiRuntime.resolveOpenRouterApiKey()) !== undefined,
  async (guildId) => (await guildConfigStore.getGuildSettings(guildId)).botLanguage,
  {
    getConnectedUserId: async () =>
      (await discordConnectionStore.getConnection())?.discordUserId ?? null,
  },
  ownerApprovals,
  (context) => permissionMonitor.checkRecording(context),
);
installVoiceStateHandler(client, coordinator, logger);
installGuildOwnershipHandler(client, coordinator, ownerApprovals, logger);
client.on(Events.GuildDelete, (guild) => {
  void membershipVerifier
    .check(guild.id)
    .then(async (status) => {
      if (status === "absent") await departureHandler.handle(guild.id);
    })
    .catch((error: unknown) => {
      logger.error(
        { errorType: getErrorType(error), guildId: guild.id },
        "Unable to reconcile bot departure from guild",
      );
    });
});

const botConfigurationMonitor = new BotConfigurationMonitor({
  expectedVersion: storedBotConfiguration.version,
  onChanged: async () => {
    logger.info("Discord bot configuration changed; restarting bot process");
    process.exitCode = BOT_CONFIGURATION_RESTART_EXIT_CODE;
    await shutdown("configuration_changed");
  },
  onError: (error) => {
    logger.warn(
      { errorType: getErrorType(error) },
      "Unable to check Discord bot configuration for restart",
    );
  },
  readVersion: () => installationSettings.getBotConfigurationVersion(),
});

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ botUserId: readyClient.user.id }, "Summyz connected to Discord");
  void (async () => {
    for (const guildId of readyClient.guilds.cache.keys()) {
      await permissionMonitor.checkGuild(guildId);
    }
  })().catch((error: unknown) => {
    logger.warn({ errorType: getErrorType(error) }, "Unable to inspect startup bot permissions");
  });
  try {
    await registerCommands(config);
    logger.info({ registrationScope: "global" }, "Commands registered");
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Command registration failed");
  }

  try {
    await artifactMaintenance.runOnce();
  } catch (error) {
    logger.error(
      { errorType: getErrorType(error) },
      "Initial artifact and transcription recovery maintenance failed",
    );
  }
  artifactMaintenance.start();

  await recoverPendingRecordings();

  try {
    for (const manifest of await manifestStore.listCompleted()) {
      // Synchronize the backend pinned in the manifest before reconciling the job.
      await manifestStore.save(manifest);
      await enqueueCompleted(manifest);
    }
  } catch (error) {
    logger.error(
      { errorType: getErrorType(error) },
      "Failed to reconcile completed meetings with the durable queue",
    );
  }
  worker.start();
  let checkingRecovery = false;
  recordingAccessTimer = setInterval(() => {
    if (checkingRecovery) return;
    checkingRecovery = true;
    void recoverPendingRecordings()
      .catch((error: unknown) => {
        logger.error(
          { errorType: getErrorType(error) },
          "Recording recovery reconciliation failed",
        );
      })
      .finally(() => {
        checkingRecovery = false;
      });
  }, 5_000);
  recordingAccessTimer.unref();
  await writeRuntimeHeartbeats();
  runtimeHeartbeatTimer = setInterval(() => {
    void writeRuntimeHeartbeats();
  }, 15_000);
  runtimeHeartbeatTimer.unref();
  botConfigurationMonitor.start();
});

let shuttingDown = false;
let runtimeHeartbeatTimer: NodeJS.Timeout | undefined;
let recordingAccessTimer: NodeJS.Timeout | undefined;
async function shutdown(reason: NodeJS.Signals | "configuration_changed"): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "Summyz shutdown requested");
  botConfigurationMonitor.stop();
  if (runtimeHeartbeatTimer !== undefined) clearInterval(runtimeHeartbeatTimer);
  if (recordingAccessTimer !== undefined) clearInterval(recordingAccessTimer);
  await coordinator.shutdown().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to stop active recordings");
  });
  await artifactMaintenance.shutdown().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to stop artifact maintenance");
  });
  await worker.shutdown().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to stop processing worker");
  });
  client.destroy();
  await database.close().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to close the PostgreSQL connection");
  });
  logger.info("Summyz stopped");
  if (process.connected) process.disconnect?.();
}

async function writeRuntimeHeartbeats(): Promise<void> {
  try {
    await Promise.all([
      installationHealth.writeHeartbeat({
        componentId: "bot-main",
        componentType: "bot",
        details: { connected: client.isReady() },
        status: client.isReady() ? "ready" : "unavailable",
      }),
      installationHealth.writeHeartbeat({
        componentId: "ffmpeg-main",
        componentType: "ffmpeg",
        details: { libopus: true },
        status: "ready",
      }),
      installationHealth.writeHeartbeat({
        componentId: "worker-main",
        componentType: "worker",
        details: { running: true },
        status: "ready",
      }),
    ]);
  } catch (error) {
    logger.warn({ errorType: getErrorType(error) }, "Unable to update runtime health heartbeat");
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("message", (message: unknown) => {
  if (message === "shutdown") void shutdown("SIGTERM");
});

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Unable to connect Summyz to Discord");
  const configurationChanged = await installationSettings
    .getBotConfigurationVersion()
    .then((version) => version !== storedBotConfiguration.version)
    .catch(() => false);
  await artifactMaintenance.shutdown().catch((shutdownError: unknown) => {
    logger.error({ errorType: getErrorType(shutdownError) }, "Unable to stop artifact maintenance");
  });
  await worker.shutdown().catch((shutdownError: unknown) => {
    logger.error({ errorType: getErrorType(shutdownError) }, "Unable to stop processing worker");
  });
  await database.close().catch(() => undefined);
  process.exitCode = configurationChanged ? BOT_CONFIGURATION_RESTART_EXIT_CODE : 1;
  if (process.connected) process.disconnect?.();
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
