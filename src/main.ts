import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { ApplicationAiRuntime, requireConfigured } from "./application-ai-runtime.js";
import { waitForBotConfiguration } from "./bot-bootstrap.js";
import { loadConfig, resolveBotConfig } from "./config.js";
import { CostReconciler } from "./cost/cost-reconciler.js";
import { createCostReportService } from "./cost/cost-report.js";
import { PostgresCostLedgerStore } from "./cost/postgres-cost-ledger-store.js";
import { PostgresAiProfileStore } from "./database/postgres-ai-profile-store.js";
import { PostgresAnalyticsStore } from "./database/postgres-analytics-store.js";
import { createPostgresDatabase, type PostgresDatabase } from "./database/postgres-database.js";
import { PostgresGuildConfigStore } from "./database/postgres-guild-config-store.js";
import { PostgresInstallationHealthStore } from "./database/postgres-installation-health-store.js";
import { PostgresInstallationSettingsStore } from "./database/postgres-installation-settings-store.js";
import { PostgresLiveMeetingStore } from "./database/postgres-live-meeting-store.js";
import { PostgresMeetingAudioCatalog } from "./database/postgres-meeting-audio-catalog.js";
import { PostgresMeetingContentStore } from "./database/postgres-meeting-content-store.js";
import { PostgresMeetingStore } from "./database/postgres-meeting-store.js";
import { DiscordMeetingPublisher } from "./discord/discord-meeting-publisher.js";
import { installInteractionHandler } from "./discord/interaction-handler.js";
import { registerCommands } from "./discord/register-commands.js";
import { notifyTranscriptionFailure } from "./discord/transcription-notifier.js";
import { installVoiceStateHandler } from "./discord/voice-state-handler.js";
import { detectLocalHardware } from "./local-ai/hardware-detection.js";
import { createLogger } from "./logger.js";
import { validateFfmpegExecutable } from "./media/ffmpeg-executable.js";
import { DurableJobQueue } from "./processing/durable-job-queue.js";
import { DurableJobWorker } from "./processing/durable-job-worker.js";
import { MeetingArtifactMaintenance } from "./processing/meeting-artifact-maintenance.js";
import { MeetingArtifactRetention } from "./processing/meeting-artifact-retention.js";
import { MeetingFinalizer } from "./processing/meeting-finalizer.js";
import { MeetingProcessingHandler } from "./processing/meeting-processing-handler.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import type { RecordingManifest } from "./recording/manifest.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";
import { MeetingRefinementGenerator } from "./refinement/meeting-refinement-generator.js";
import { MeetingRefinementService } from "./refinement/meeting-refinement-service.js";
import { OllamaRefinementProvider } from "./refinement/ollama-refinement-provider.js";
import { OpenRouterRefinementProvider } from "./refinement/openrouter-refinement-provider.js";
import { RefinementStore } from "./refinement/refinement-store.js";
import { SecretBox } from "./security/secret-box.js";
import { MeetingSummaryGenerator } from "./summary/meeting-summary-generator.js";
import { MeetingSummaryService } from "./summary/meeting-summary-service.js";
import { OllamaSummaryProvider } from "./summary/ollama-summary-provider.js";
import { OpenRouterSummaryProvider } from "./summary/openrouter-summary-provider.js";
import { PublicationStore } from "./summary/publication-store.js";
import { resolveSummaryLanguage } from "./summary/summary-language.js";
import { SummaryStore } from "./summary/summary-store.js";
import { configureTerminalEncoding } from "./terminal-encoding.js";
import { MeetingTranscriptionService } from "./transcription/meeting-transcription-service.js";
import {
  createAudioDecoder,
  FullAudioSpeechAnalyzer,
  SileroSpeechAnalyzer,
} from "./transcription/speech-analyzer.js";
import { CURRENT_TRANSCRIPTION_RECOVERY_VERSION } from "./transcription/transcription-recovery-policy.js";
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
logger.info("Waiting for dashboard setup before connecting to Discord");
const storedBotConfiguration = await waitForBotConfiguration({
  read: async () => {
    const settings = await installationSettings.getSettings();
    return {
      discordApplicationId: settings.discordApplicationId,
      discordToken: await installationSettings.getSecret("discord_bot_token"),
      setupCompleted: settings.setupCompleted,
    };
  },
});
const config: ReturnType<typeof resolveBotConfig> = resolveBotConfig(
  bootstrapConfig,
  storedBotConfiguration,
);

const localHardware = await detectLocalHardware();
const recordingsDirectory = join(config.dataDir, "recordings");

const postgresMeetingStore = new PostgresMeetingStore(database);
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
const guildConfigStore = new PostgresGuildConfigStore(database);
const aiProfileStore = new PostgresAiProfileStore(database);
const liveMeetingStore = new PostgresLiveMeetingStore(database);
const aiRuntime = new ApplicationAiRuntime({
  aiProfileStore,
  client,
  config,
  costStore: postgresCostLedger,
  hardware: localHardware,
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
const meetingPublisher = new DiscordMeetingPublisher({
  client,
  guildConfigStore,
  language: config.botLanguage,
  logger,
  store: publicationStore,
  timeZone: config.summaryTimeZone,
});
const summaryService = new MeetingSummaryService({
  logger,
  publisher: meetingPublisher,
  refinementStore,
  resolveGenerator: async (manifest) => {
    const configuration = aiRuntime.getMeetingConfiguration(manifest);
    const selection = configuration.summary;
    const language = resolveSummaryLanguage({
      detectedLanguage: manifest.predominantLanguage,
      summaryLanguage: configuration.language,
      transcriptionLanguage: configuration.transcription.language,
    });
    const apiKey =
      selection.provider === "openrouter" ? await aiRuntime.requireOpenRouterApiKey() : undefined;
    const costRecorder = aiRuntime.createCostRecorder(manifest, "summary", apiKey);
    const provider =
      selection.provider === "ollama"
        ? new OllamaSummaryProvider({
            consolidationPrompt: selection.consolidationPrompt,
            costRecorder,
            extractionPrompt: selection.extractionPrompt,
            generation: selection.generation,
            language,
            model: selection.model,
            timeoutMs: config.summaryTimeoutMs,
          })
        : new OpenRouterSummaryProvider({
            apiKey: requireConfigured(apiKey, "OpenRouter API key"),
            consolidationPrompt: selection.consolidationPrompt,
            costRecorder,
            extractionPrompt: selection.extractionPrompt,
            generation: selection.generation,
            language,
            logger,
            maxAttempts: config.summaryMaxAttempts,
            model: selection.model,
            retryBaseMs: config.summaryRetryBaseMs,
            retryMaxMs: config.summaryRetryMaxMs,
            timeoutMs: config.summaryTimeoutMs,
          });
    const generator = new MeetingSummaryGenerator({
      maxChunkCharacters: selection.maxChunkCharacters,
      provider,
    });
    return generator;
  },
  summaryStore,
  timeZone: config.summaryTimeZone,
  transcriptionStore,
});
const refinementService = new MeetingRefinementService({
  logger,
  refinementStore,
  resolveGenerator: async (manifest) => {
    const selection = aiRuntime.getMeetingConfiguration(manifest).refinement;
    const apiKey =
      selection.provider === "openrouter" ? await aiRuntime.requireOpenRouterApiKey() : undefined;
    const costRecorder = aiRuntime.createCostRecorder(manifest, "refinement", apiKey);
    const provider =
      selection.provider === "ollama"
        ? new OllamaRefinementProvider({
            costRecorder,
            generation: selection.generation,
            model: selection.model,
            prompt: selection.prompt,
            timeoutMs: config.refinementTimeoutMs,
          })
        : new OpenRouterRefinementProvider({
            apiKey: requireConfigured(apiKey, "OpenRouter API key"),
            costRecorder,
            generation: selection.generation,
            logger,
            maxAttempts: config.refinementMaxAttempts,
            model: selection.model,
            prompt: selection.prompt,
            retryBaseMs: config.refinementRetryBaseMs,
            retryMaxMs: config.refinementRetryMaxMs,
            timeoutMs: config.refinementTimeoutMs,
          });
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: selection.maxChunkCharacters,
      provider,
    });
    return generator;
  },
  transcriptionStore,
});
const decodeMeetingAudio = createAudioDecoder(config.segmentMaxSeconds);
const transcriptionService = new MeetingTranscriptionService({
  concurrency: config.transcriptionConcurrency,
  interSpeechSilenceMs: 0,
  logger,
  manifestStore,
  notifyFailure: (manifest) =>
    notifyTranscriptionFailure(
      client,
      logger,
      manifest,
      manifest.botLanguage ?? config.botLanguage,
    ),
  publishTranscriptOnly: (manifest, transcriptPath) =>
    meetingPublisher.publishTranscriptOnly(manifest, transcriptPath),
  resolveProvider: (manifest) => {
    const selection = aiRuntime.getMeetingConfiguration(manifest).transcription;
    return aiRuntime.createTranscriptionProvider(selection, manifest);
  },
  resolveSpeechAnalyzer: (manifest) => {
    const configuration = aiRuntime.getMeetingConfiguration(manifest);
    if (configuration.profileType === "external" && configuration.transcription.vad.enabled) {
      const vad = configuration.transcription.vad;
      return new SileroSpeechAnalyzer({
        decodeAudio: decodeMeetingAudio,
        minSilenceDurationMs: vad.minSilenceDurationMs,
        minSpeechDurationMs: vad.minSpeechDurationMs,
        negativeSpeechThreshold:
          vad.negativeSpeechThreshold === "auto"
            ? Math.max(0, vad.threshold - 0.15)
            : vad.negativeSpeechThreshold,
        speechPadMs: vad.speechPadMs,
        threshold: vad.threshold,
      });
    }
    return new FullAudioSpeechAnalyzer({ decodeAudio: decodeMeetingAudio });
  },
  transcriptionStore,
  transcriptionMergeMaxGapMs: 2_000,
  transcriptionWindowMaxMs: config.transcriptionWindowMaxSeconds * 1_000,
});

const retention = new MeetingArtifactRetention(transcriptionStore, logger);
const postgresQueue = new DurableJobQueue(database);
const postgresFinalizer = new MeetingFinalizer({
  contentStore: new PostgresMeetingContentStore(database),
  manifestStore,
  participationStore: new PostgresAnalyticsStore(database),
  publicationStore,
  retention,
  summaryStore,
  transcriptionStore,
});
const processingHandler = new MeetingProcessingHandler({
  audioCatalog: new PostgresMeetingAudioCatalog(database),
  finalizer: postgresFinalizer,
  meetingStore: postgresMeetingStore,
  queue: postgresQueue,
  refinementStore,
  refiner: refinementService,
  retention,
  summarizer: summaryService,
  summaryStore,
  transcriber: transcriptionService,
  transcriptionStore,
});
const artifactMaintenance = new MeetingArtifactMaintenance({
  cleanup: (meetingId) => processingHandler.cleanup(meetingId),
  logger,
  meetingStore: postgresMeetingStore,
  queue: postgresQueue,
  recoveryVersion: CURRENT_TRANSCRIPTION_RECOVERY_VERSION,
});
const worker = new DurableJobWorker({ handler: processingHandler, logger, queue: postgresQueue });

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
const coordinator = new RecordingCoordinator(recordingFactory);

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
);
installVoiceStateHandler(client, coordinator, logger);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ botUserId: readyClient.user.id }, "Summyz connected to Discord");
  try {
    await registerCommands(config);
    logger.info(
      { registrationScope: config.discordGuildId === undefined ? "global" : "guild" },
      "Commands registered",
    );
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

  try {
    for (const manifest of await manifestStore.listRecoverable()) {
      await coordinator.resume(manifest);
    }
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Previous recording recovery failed");
  }

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
  await writeRuntimeHeartbeats();
  runtimeHeartbeatTimer = setInterval(() => {
    void writeRuntimeHeartbeats();
  }, 15_000);
  runtimeHeartbeatTimer.unref();
});

let shuttingDown = false;
let runtimeHeartbeatTimer: NodeJS.Timeout | undefined;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Summyz shutdown requested");
  if (runtimeHeartbeatTimer !== undefined) clearInterval(runtimeHeartbeatTimer);
  await coordinator.shutdown();
  await artifactMaintenance.shutdown();
  await worker.shutdown();
  client.destroy();
  await database.close().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to close the PostgreSQL connection");
  });
  logger.info("Summyz stopped");
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

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Unable to connect Summyz to Discord");
  await artifactMaintenance.shutdown();
  await worker.shutdown();
  await database.close().catch(() => undefined);
  process.exitCode = 1;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
