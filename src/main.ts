import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { assessModelCompatibility, resolveAiProfile } from "./ai-profile.js";
import { CombinedCostLedgerReader } from "./cost/combined-cost-ledger-reader.js";
import { CostReconciler } from "./cost/cost-reconciler.js";
import type { CostLedgerStore, CostPhase } from "./cost/cost-ledger.js";
import { createCostReportService } from "./cost/cost-report.js";
import { LocalCostLedgerStore } from "./cost/local-cost-ledger-store.js";
import { PostgresCostLedgerStore } from "./cost/postgres-cost-ledger-store.js";
import { ProviderCostRecorder } from "./cost/provider-cost-recorder.js";

import { loadConfig } from "./config.js";
import { PostgresAiProfileStore } from "./database/postgres-ai-profile-store.js";
import { PostgresGuildConfigStore } from "./database/postgres-guild-config-store.js";
import { PostgresMeetingAudioCatalog } from "./database/postgres-meeting-audio-catalog.js";
import { PostgresMeetingContentStore } from "./database/postgres-meeting-content-store.js";
import { PostgresMeetingStore } from "./database/postgres-meeting-store.js";
import { createPostgresDatabase, type PostgresDatabase } from "./database/postgres-database.js";
import { DiscordMeetingPublisher } from "./discord/discord-meeting-publisher.js";
import { installInteractionHandler } from "./discord/interaction-handler.js";
import { registerCommands } from "./discord/register-commands.js";
import { notifyTranscriptionFailure } from "./discord/transcription-notifier.js";
import { installVoiceStateHandler } from "./discord/voice-state-handler.js";
import { createLogger } from "./logger.js";
import { LocalModelManager } from "./local-ai/local-model-manager.js";
import { resolveFasterWhisperBatchSize } from "./local-ai/faster-whisper-batch-size.js";
import { detectLocalHardware } from "./local-ai/hardware-detection.js";
import { resolveLocalExecutionPlan, type LocalAiPhase } from "./local-ai/local-execution-policy.js";
import { DurableJobQueue } from "./processing/durable-job-queue.js";
import { DurableJobWorker } from "./processing/durable-job-worker.js";
import { LocalDurableJobQueue } from "./processing/local-durable-job-queue.js";
import { LocalMeetingAudioCatalog } from "./processing/local-meeting-audio-catalog.js";
import { LocalMeetingContentStore } from "./processing/local-meeting-content-store.js";
import { LocalMeetingStore } from "./processing/local-meeting-store.js";
import { MeetingArtifactRetention } from "./processing/meeting-artifact-retention.js";
import { MeetingFinalizer } from "./processing/meeting-finalizer.js";
import { MeetingProcessingHandler } from "./processing/meeting-processing-handler.js";
import { MeetingRefinementGenerator } from "./refinement/meeting-refinement-generator.js";
import { MeetingRefinementService } from "./refinement/meeting-refinement-service.js";
import { OllamaRefinementProvider } from "./refinement/ollama-refinement-provider.js";
import { OpenRouterRefinementProvider } from "./refinement/openrouter-refinement-provider.js";
import { RefinementStore } from "./refinement/refinement-store.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import {
  meetingAiConfigurationSchema,
  type ResolvedMeetingAiConfiguration,
  type RecordingManifest,
} from "./recording/manifest.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";
import { MeetingSummaryGenerator } from "./summary/meeting-summary-generator.js";
import { MeetingSummaryService } from "./summary/meeting-summary-service.js";
import { OllamaSummaryProvider } from "./summary/ollama-summary-provider.js";
import { OpenRouterSummaryProvider } from "./summary/openrouter-summary-provider.js";
import { PublicationStore } from "./summary/publication-store.js";
import { SummaryStore } from "./summary/summary-store.js";
import { configureTerminalEncoding } from "./terminal-encoding.js";
import { MeetingTranscriptionService } from "./transcription/meeting-transcription-service.js";
import { FasterWhisperTranscriptionProvider } from "./transcription/faster-whisper-transcription-provider.js";
import { OpenRouterTranscriptionProvider } from "./transcription/openrouter-transcription-provider.js";
import { SileroSpeechAnalyzer } from "./transcription/speech-analyzer.js";
import type { TranscriptionModelProfile } from "./transcription/transcription-model-profile.js";
import { TranscriptionStore } from "./transcription/transcription-store.js";
import type { TranscriptionProvider } from "./transcription/transcription-provider.js";

const terminalEncoding = configureTerminalEncoding();

if (existsSync(".env")) {
  loadEnvFile(".env");
}

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch {
  console.error("Invalid configuration. Review .env.");
  process.exitCode = 1;
  throw new Error("Invalid configuration");
}

const logger = createLogger(config.logLevel);
if (!terminalEncoding.configured) {
  logger.warn(
    { errorType: terminalEncoding.errorType },
    "Unable to configure the Windows terminal for UTF-8",
  );
}

const localHardware = await detectLocalHardware();

const recordingsDirectory = join(config.dataDir, "recordings");
const database: PostgresDatabase = createPostgresDatabase(config.databaseUrl);
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

const postgresMeetingStore = new PostgresMeetingStore(database);
const manifestStore = new ManifestStore(recordingsDirectory, postgresMeetingStore);
const localCostLedger = new LocalCostLedgerStore(join(config.dataDir, "costs"));
const postgresCostLedger = new PostgresCostLedgerStore(database);
const costReconcilers =
  config.openRouterApiKey === undefined
    ? []
    : [
        new CostReconciler({ apiKey: config.openRouterApiKey, logger, store: localCostLedger }),
        new CostReconciler({
          apiKey: config.openRouterApiKey,
          logger,
          store: postgresCostLedger,
        }),
      ];
const costReport = createCostReportService({
  language: config.botLanguage,
  reconcile: async (guildId) => {
    await Promise.all(costReconcilers.map((reconciler) => reconciler.reconcile(guildId)));
  },
  store: new CombinedCostLedgerReader([localCostLedger, postgresCostLedger]),
  timeZone: config.summaryTimeZone,
});
const localQueue = new LocalDurableJobQueue(join(config.dataDir, "processing.json"));
try {
  await localQueue.initialize();
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Unable to initialize the local durable queue");
  await database.close().catch(() => undefined);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const guildConfigStore = new PostgresGuildConfigStore(database);
const aiProfileStore = new PostgresAiProfileStore(database);
const transcriptionStore = new TranscriptionStore(recordingsDirectory);
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
  resolveGenerator: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).summary;
    const costRecorder = createProviderCostRecorder(manifest, "summary");
    const provider =
      selection.provider === "ollama"
        ? new OllamaSummaryProvider({
            costRecorder,
            generation: selection.generation,
            language: selection.language,
            model: selection.model,
            timeoutMs: config.summaryTimeoutMs,
          })
        : new OpenRouterSummaryProvider({
            apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
            costRecorder,
            generation: selection.generation,
            language: selection.language,
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
  transcriptionStore,
});
const refinementService = new MeetingRefinementService({
  logger,
  refinementStore,
  resolveGenerator: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).refinement;
    const costRecorder = createProviderCostRecorder(manifest, "refinement");
    const provider =
      selection.provider === "ollama"
        ? new OllamaRefinementProvider({
            costRecorder,
            generation: selection.generation,
            model: selection.model,
            timeoutMs: config.refinementTimeoutMs,
          })
        : new OpenRouterRefinementProvider({
            apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
            costRecorder,
            generation: selection.generation,
            logger,
            maxAttempts: config.refinementMaxAttempts,
            model: selection.model,
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
const speechAnalyzer = new SileroSpeechAnalyzer({
  maxDurationSeconds: config.segmentMaxSeconds,
  minSpeechDurationMs: config.transcriptionVadMinSpeechMs,
  threshold: config.transcriptionVadThreshold,
});
const transcriptionService = new MeetingTranscriptionService({
  concurrency: config.transcriptionConcurrency,
  interSpeechSilenceMs: 0,
  logger,
  manifestStore,
  notifyFailure: (manifest) =>
    notifyTranscriptionFailure(client, logger, manifest, config.botLanguage),
  resolveProvider: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).transcription;
    return createTranscriptionProvider(selection, manifest);
  },
  speechAnalyzer,
  transcriptionStore,
  transcriptionMergeMaxGapMs: 2_000,
  transcriptionWindowMaxMs: config.transcriptionWindowMaxSeconds * 1_000,
});

const retention = new MeetingArtifactRetention(transcriptionStore, logger);
const localMeetingStore = new LocalMeetingStore(manifestStore, localQueue);
const localFinalizer = new MeetingFinalizer({
  contentStore: new LocalMeetingContentStore(),
  manifestStore,
  publicationStore,
  retention,
  summaryStore,
  transcriptionStore,
});
const localProcessingHandler = new MeetingProcessingHandler({
  audioCatalog: new LocalMeetingAudioCatalog(recordingsDirectory),
  finalizer: localFinalizer,
  meetingStore: localMeetingStore,
  queue: localQueue,
  refinementStore,
  refiner: refinementService,
  retention,
  summarizer: summaryService,
  summaryStore,
  transcriber: transcriptionService,
  transcriptionStore,
});
const workers = [
  new DurableJobWorker({ handler: localProcessingHandler, logger, queue: localQueue }),
];

const postgresQueue = new DurableJobQueue(database);
const postgresFinalizer = new MeetingFinalizer({
  contentStore: new PostgresMeetingContentStore(database),
  manifestStore,
  publicationStore,
  retention,
  summaryStore,
  transcriptionStore,
});
const postgresProcessingHandler = new MeetingProcessingHandler({
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
workers.push(
  new DurableJobWorker({ handler: postgresProcessingHandler, logger, queue: postgresQueue }),
);

async function enqueueCompleted(manifest: RecordingManifest): Promise<void> {
  await selectCostLedger(manifest).saveMeeting(manifest);
  if (manifest.storageMode === "local") {
    await localQueue.enqueue(manifest.meetingId, "transcription");
    return;
  }
  await postgresQueue.enqueue(manifest.meetingId, "transcription");
}

const recordingFactory = new DiscordRecordingFactory(
  client,
  config,
  manifestStore,
  logger,
  enqueueCompleted,
  resolveAndPrepareMeetingAiConfiguration,
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
  assessActiveAiProfile,
  () => config.openRouterApiKey !== undefined,
);
installVoiceStateHandler(client, coordinator, logger);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ botUserId: readyClient.user.id }, "Summyz connected to Discord");
  try {
    await Promise.all(
      readyClient.guilds.cache.map((guild) => aiProfileStore.ensureInitialProfile(guild.id)),
    );
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Unable to initialize guild AI profiles");
  }
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
    for (const meetingId of await localMeetingStore.listTerminalMeetingIds()) {
      await localProcessingHandler.cleanup(meetingId);
    }
    for (const meetingId of await postgresMeetingStore.listTerminalMeetingIds()) {
      await postgresProcessingHandler.cleanup(meetingId);
    }
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
  for (const worker of workers) worker.start();
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Summyz shutdown requested");
  await coordinator.shutdown();
  await Promise.all(workers.map(async (worker) => worker.shutdown()));
  try {
    await speechAnalyzer.close();
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Unable to close the local speech detector");
  }
  client.destroy();
  await database.close().catch((error: unknown) => {
    logger.error({ errorType: getErrorType(error) }, "Unable to close the PostgreSQL connection");
  });
  logger.info("Summyz stopped");
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
  await Promise.all(workers.map(async (worker) => worker.shutdown()));
  await speechAnalyzer.close().catch(() => undefined);
  await database.close().catch(() => undefined);
  process.exitCode = 1;
}

function getMeetingAiConfiguration(manifest: RecordingManifest): ResolvedMeetingAiConfiguration {
  if (manifest.aiConfiguration === undefined) {
    throw new Error("The meeting does not have a pinned AI profile");
  }
  return meetingAiConfigurationSchema.parse(manifest.aiConfiguration);
}

async function resolveAndPrepareMeetingAiConfiguration(
  guildId: string,
): Promise<ResolvedMeetingAiConfiguration> {
  await aiProfileStore.ensureInitialProfile(guildId);
  const profile = await aiProfileStore.getActiveProfile(guildId);
  let configuration = meetingAiConfigurationSchema.parse(resolveAiProfile(profile));
  const localAiPhases = localPhases(configuration);
  const executionPlan = resolveLocalExecutionPlan({
    device: config.localAiDevice,
    enabledPhases: localAiPhases,
    fallback: config.localAiFallback,
    hardware: localHardware,
  });
  for (const phase of localAiPhases) {
    const execution = executionPlan[phase];
    const details = {
      device: execution.device,
      fallback: execution.fallback,
      fallbackApplied: execution.fallbackApplied,
      ...(execution.gpuVendor === undefined ? {} : { gpuVendor: execution.gpuVendor }),
      phase,
    };
    if (execution.fallbackApplied) {
      logger.warn(
        { ...details, event: "local_ai_cpu_fallback_applied" },
        "Local AI CPU fallback applied",
      );
    } else {
      logger.info(details, "Local AI execution device selected");
    }
  }
  if (configuration.transcription.provider === "faster-whisper") {
    const batchSize = resolveFasterWhisperBatchSize(
      configuration.transcription.batchSize,
      configuration.transcription.model,
      executionPlan.transcription,
      config.transcriptionConcurrency,
    );
    configuration = meetingAiConfigurationSchema.parse({
      ...configuration,
      transcription: { ...configuration.transcription, batchSize },
    });
  }
  if (localAiPhases.length > 0) {
    await new LocalModelManager({
      batchSize:
        configuration.transcription.provider === "faster-whisper" &&
        typeof configuration.transcription.batchSize === "number"
          ? configuration.transcription.batchSize
          : 0,
      configuration,
      executionPlan,
      logger,
    }).prepare();
  }
  return configuration;
}

function localPhases(configuration: ResolvedMeetingAiConfiguration): LocalAiPhase[] {
  return [
    ...(configuration.refinement.provider === "ollama" ? (["refinement"] as const) : []),
    ...(configuration.summary.provider === "ollama" ? (["summary"] as const) : []),
    ...(configuration.transcription.provider === "faster-whisper"
      ? (["transcription"] as const)
      : []),
  ];
}

async function assessActiveAiProfile(guildId: string) {
  const profile = await aiProfileStore.getActiveProfile(guildId);
  let configuration: ResolvedMeetingAiConfiguration;
  try {
    configuration = meetingAiConfigurationSchema.parse(resolveAiProfile(profile));
  } catch {
    return [];
  }
  let executionPlan: ReturnType<typeof resolveLocalExecutionPlan>;
  try {
    executionPlan = resolveLocalExecutionPlan({
      device: config.localAiDevice,
      enabledPhases: localPhases(configuration),
      fallback: config.localAiFallback,
      hardware: localHardware,
    });
  } catch {
    return ["incompatible" as const];
  }
  return [
    ...(configuration.transcription.provider === "faster-whisper"
      ? [
          assessModelCompatibility({
            device: executionPlan.transcription.device,
            hardware: localHardware,
            model: configuration.transcription.model,
            phase: "transcription",
            provider: "faster-whisper",
          }),
        ]
      : []),
    ...(configuration.refinement.provider === "ollama"
      ? [
          assessModelCompatibility({
            device: executionPlan.refinement.device,
            hardware: localHardware,
            model: configuration.refinement.model,
            phase: "refinement",
            provider: "ollama",
          }),
        ]
      : []),
    ...(configuration.summary.provider === "ollama"
      ? [
          assessModelCompatibility({
            device: executionPlan.summary.device,
            hardware: localHardware,
            model: configuration.summary.model,
            phase: "summary",
            provider: "ollama",
          }),
        ]
      : []),
  ];
}

async function createTranscriptionProvider(
  selection: ResolvedMeetingAiConfiguration["transcription"],
  manifest: RecordingManifest,
): Promise<TranscriptionProvider> {
  const costRecorder = createProviderCostRecorder(manifest, "transcription");
  if (selection.provider === "faster-whisper") {
    const executionPlan = resolveLocalExecutionPlan({
      device: config.localAiDevice,
      enabledPhases: ["transcription"],
      fallback: config.localAiFallback,
      hardware: localHardware,
    });
    return new FasterWhisperTranscriptionProvider({
      batchSize: typeof selection.batchSize === "number" ? selection.batchSize : 0,
      costRecorder,
      device: executionPlan.transcription.device,
      fallback: executionPlan.transcription.fallback,
      language: selection.language,
      model: selection.model,
      timeoutMs: config.transcriptionTimeoutMs,
    });
  }
  const profile: TranscriptionModelProfile = {
    interSpeechSilenceMs: selection.interSpeechSilenceMs,
    ...(selection.mergeMaxGapMs === undefined ? {} : { mergeMaxGapMs: selection.mergeMaxGapMs }),
    ...(selection.prompt === undefined ? {} : { prompt: selection.prompt }),
    ...(selection.providerOptions === undefined
      ? {}
      : { providerOptions: selection.providerOptions }),
    ...(selection.temperature === undefined ? {} : { temperature: selection.temperature }),
    timestampMode: selection.timestampMode,
  };
  return new OpenRouterTranscriptionProvider({
    apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
    costRecorder,
    language: selection.language,
    logger,
    maxAttempts: config.transcriptionMaxAttempts,
    model: selection.model,
    profile,
    retryBaseMs: config.transcriptionRetryBaseMs,
    retryMaxMs: config.transcriptionRetryMaxMs,
    timeoutMs: config.transcriptionTimeoutMs,
  });
}

function createProviderCostRecorder(
  manifest: RecordingManifest,
  phase: CostPhase,
): ProviderCostRecorder {
  const apiKey = config.openRouterApiKey;
  return new ProviderCostRecorder({
    context: { guildId: manifest.guildId, meetingId: manifest.meetingId, phase },
    logger,
    ...(apiKey === undefined ? {} : { openRouter: { apiKey } }),
    store: selectCostLedger(manifest),
  });
}

function selectCostLedger(manifest: RecordingManifest): CostLedgerStore {
  if (manifest.storageMode === "local") return localCostLedger;
  return postgresCostLedger;
}

function requireConfigured(value: string | undefined, variableName: string): string {
  if (value === undefined) {
    throw new Error(`${variableName} is required by the provider pinned to this meeting`);
  }
  return value;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
