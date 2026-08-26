import { existsSync } from "node:fs";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
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
import { GuildConfigStore } from "./guild-config-store.js";
import { createLogger } from "./logger.js";
import { LocalModelManager } from "./local-ai/local-model-manager.js";
import { createMeetingAiConfiguration } from "./local-ai/meeting-ai-configuration.js";
import { DurableJobQueue } from "./processing/durable-job-queue.js";
import { DurableJobWorker } from "./processing/durable-job-worker.js";
import { LocalDurableJobQueue } from "./processing/local-durable-job-queue.js";
import { LocalMeetingAudioCatalog } from "./processing/local-meeting-audio-catalog.js";
import { LocalMeetingContentStore } from "./processing/local-meeting-content-store.js";
import { LocalMeetingStore } from "./processing/local-meeting-store.js";
import { MeetingArtifactRetention } from "./processing/meeting-artifact-retention.js";
import { MeetingFinalizer } from "./processing/meeting-finalizer.js";
import { MeetingProcessingHandler } from "./processing/meeting-processing-handler.js";
import { requiresPostgres } from "./processing/storage-routing.js";
import { MeetingRefinementGenerator } from "./refinement/meeting-refinement-generator.js";
import { MeetingRefinementService } from "./refinement/meeting-refinement-service.js";
import { OllamaRefinementProvider } from "./refinement/ollama-refinement-provider.js";
import { OpenRouterRefinementProvider } from "./refinement/openrouter-refinement-provider.js";
import { RefinementStore } from "./refinement/refinement-store.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import type { MeetingAiConfiguration, RecordingManifest } from "./recording/manifest.js";
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
import {
  loadTranscriptionModelProfile,
  type TranscriptionModelProfile,
} from "./transcription/transcription-model-profile.js";
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

const meetingAiConfiguration = createMeetingAiConfiguration(config, {
  cpuCores: availableParallelism(),
  memoryBytes: totalmem(),
});
const localModelManager = new LocalModelManager({
  configuration: meetingAiConfiguration,
  logger,
});
localModelManager.start();

let transcriptionModelProfile: TranscriptionModelProfile = {
  interSpeechSilenceMs: 0,
  temperature: 0,
  timestampMode: "word",
};
if (
  meetingAiConfiguration.transcription.provider === "openrouter" &&
  meetingAiConfiguration.transcription.status === "selected"
) {
  try {
    transcriptionModelProfile = await loadTranscriptionModelProfile(
      config.transcriptionModelProfilesFile,
      meetingAiConfiguration.transcription.model,
    );
  } catch (error) {
    logger.fatal(
      { errorType: getErrorType(error) },
      "Unable to load the configured transcription model profile",
    );
    process.exit(1);
  }
}

const recordingsDirectory = join(config.dataDir, "recordings");
const discoveryManifestStore = new ManifestStore(recordingsDirectory);
let startupManifests: RecordingManifest[];
try {
  startupManifests = [
    ...(await discoveryManifestStore.listRecoverable()),
    ...(await discoveryManifestStore.listCompleted()),
  ];
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Unable to read meetings stored on disk");
  process.exit(1);
}

const postgresRequired = requiresPostgres(config.storageMode, startupManifests);
let database: PostgresDatabase | undefined;
if (postgresRequired) {
  if (config.databaseUrl === undefined) {
    logger.fatal(
      "DATABASE_URL is required because PostgreSQL storage is active or a meeting is pending.",
    );
    process.exit(1);
  }
  const candidate = createPostgresDatabase(config.databaseUrl);
  try {
    await candidate.initialize();
    database = candidate;
    logger.info("PostgreSQL initialized");
  } catch (error) {
    logger.fatal(
      { errorType: getErrorType(error) },
      "Unable to initialize PostgreSQL; check DATABASE_URL and database availability",
    );
    await candidate.close().catch(() => undefined);
    process.exit(1);
  }
} else {
  logger.info("Local storage initialized without PostgreSQL");
}

const postgresMeetingStore =
  database === undefined ? undefined : new PostgresMeetingStore(database);
const manifestStore = new ManifestStore(recordingsDirectory, postgresMeetingStore);
const localQueue = new LocalDurableJobQueue(join(config.dataDir, "processing.json"));
try {
  await localQueue.initialize();
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Unable to initialize the local durable queue");
  await database?.close().catch(() => undefined);
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const guildConfigStore =
  config.storageMode === "postgres"
    ? new PostgresGuildConfigStore(requireDatabase(database))
    : new GuildConfigStore(join(config.dataDir, "guild-config.json"));
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
const summaryGenerators = new Map<string, MeetingSummaryGenerator>();
const summaryService = new MeetingSummaryService({
  logger,
  publisher: meetingPublisher,
  refinementStore,
  resolveGenerator: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).summary;
    const key = JSON.stringify(selection);
    const cached = summaryGenerators.get(key);
    if (cached !== undefined) return cached;
    const provider =
      selection.provider === "ollama"
        ? new OllamaSummaryProvider({
            language: selection.language,
            model: selection.model,
            onIncompatibleModel: (model) => localModelManager.rejectOllamaModel(model, "summary"),
            timeoutMs: config.summaryTimeoutMs,
          })
        : new OpenRouterSummaryProvider({
            apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
            language: selection.language,
            logger,
            maxAttempts: config.summaryMaxAttempts,
            model: selection.model,
            retryBaseMs: config.summaryRetryBaseMs,
            retryMaxMs: config.summaryRetryMaxMs,
            timeoutMs: config.summaryTimeoutMs,
          });
    const generator = new MeetingSummaryGenerator({
      maxChunkCharacters: config.summaryChunkMaxCharacters,
      provider,
    });
    summaryGenerators.set(key, generator);
    return generator;
  },
  summaryStore,
  transcriptionStore,
});
const refinementGenerators = new Map<string, MeetingRefinementGenerator>();
const refinementService = new MeetingRefinementService({
  logger,
  refinementStore,
  resolveGenerator: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).refinement;
    const key = JSON.stringify(selection);
    const cached = refinementGenerators.get(key);
    if (cached !== undefined) return cached;
    const provider =
      selection.provider === "ollama"
        ? new OllamaRefinementProvider({
            model: selection.model,
            onIncompatibleModel: (model) =>
              localModelManager.rejectOllamaModel(model, "refinement"),
            timeoutMs: config.refinementTimeoutMs,
          })
        : new OpenRouterRefinementProvider({
            apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
            logger,
            maxAttempts: config.refinementMaxAttempts,
            model: selection.model,
            retryBaseMs: config.refinementRetryBaseMs,
            retryMaxMs: config.refinementRetryMaxMs,
            timeoutMs: config.refinementTimeoutMs,
          });
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: config.refinementChunkMaxCharacters,
      provider,
    });
    refinementGenerators.set(key, generator);
    return generator;
  },
  transcriptionStore,
});
const transcriptionProviders = new Map<string, Promise<TranscriptionProvider>>();
const speechAnalyzer = new SileroSpeechAnalyzer({
  maxDurationSeconds: config.segmentMaxSeconds,
  minSpeechDurationMs: config.transcriptionVadMinSpeechMs,
  threshold: config.transcriptionVadThreshold,
});
const transcriptionService = new MeetingTranscriptionService({
  concurrency: config.transcriptionConcurrency,
  interSpeechSilenceMs: transcriptionModelProfile.interSpeechSilenceMs,
  logger,
  manifestStore,
  notifyFailure: (manifest) =>
    notifyTranscriptionFailure(client, logger, manifest, config.botLanguage),
  resolveProvider: (manifest) => {
    const selection = getMeetingAiConfiguration(manifest).transcription;
    const key = JSON.stringify(selection);
    const cached = transcriptionProviders.get(key);
    if (cached !== undefined) return cached;
    const provider = createTranscriptionProvider(selection);
    transcriptionProviders.set(key, provider);
    return provider;
  },
  speechAnalyzer,
  transcriptionStore,
  transcriptionMergeMaxGapMs:
    transcriptionModelProfile.mergeMaxGapMs ?? config.transcriptionMergeMaxGapMs,
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

const postgresQueue = database === undefined ? undefined : new DurableJobQueue(database);
let postgresProcessingHandler: MeetingProcessingHandler | undefined;
if (database !== undefined && postgresMeetingStore !== undefined && postgresQueue !== undefined) {
  const postgresFinalizer = new MeetingFinalizer({
    contentStore: new PostgresMeetingContentStore(database),
    manifestStore,
    publicationStore,
    retention,
    summaryStore,
    transcriptionStore,
  });
  postgresProcessingHandler = new MeetingProcessingHandler({
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
}

async function enqueueCompleted(manifest: RecordingManifest): Promise<void> {
  if (manifest.storageMode === "local") {
    await localQueue.enqueue(manifest.meetingId, "transcription");
    return;
  }
  if (postgresQueue === undefined) {
    throw new Error("A fila PostgreSQL da reunião não está disponível");
  }
  await postgresQueue.enqueue(manifest.meetingId, "transcription");
}

const recordingFactory = new DiscordRecordingFactory(
  client,
  config,
  manifestStore,
  logger,
  enqueueCompleted,
  meetingAiConfiguration,
);
const coordinator = new RecordingCoordinator(recordingFactory);

installInteractionHandler(client, guildConfigStore, coordinator, logger, config.botLanguage, () =>
  localModelManager.hasInsufficientHardware(),
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
    for (const meetingId of await localMeetingStore.listTerminalMeetingIds()) {
      await localProcessingHandler.cleanup(meetingId);
    }
    if (postgresMeetingStore !== undefined && postgresProcessingHandler !== undefined) {
      for (const meetingId of await postgresMeetingStore.listTerminalMeetingIds()) {
        await postgresProcessingHandler.cleanup(meetingId);
      }
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
  localModelManager.shutdown();
  logger.info({ signal }, "Summyz shutdown requested");
  await coordinator.shutdown();
  await Promise.all(workers.map(async (worker) => worker.shutdown()));
  try {
    await speechAnalyzer.close();
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Unable to close the local speech detector");
  }
  client.destroy();
  await database?.close().catch((error: unknown) => {
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
  await database?.close().catch(() => undefined);
  process.exitCode = 1;
}

function requireDatabase(value: PostgresDatabase | undefined): PostgresDatabase {
  if (value === undefined) throw new Error("PostgreSQL não foi inicializado");
  return value;
}

function getMeetingAiConfiguration(manifest: RecordingManifest): MeetingAiConfiguration {
  return manifest.aiConfiguration ?? meetingAiConfiguration;
}

async function createTranscriptionProvider(
  selection: Extract<MeetingAiConfiguration["transcription"], { status: "selected" }>,
): Promise<TranscriptionProvider> {
  if (selection.provider === "faster-whisper") {
    return new FasterWhisperTranscriptionProvider({
      language: selection.language,
      model: selection.model,
      timeoutMs: config.transcriptionTimeoutMs,
    });
  }
  const profile = await loadTranscriptionModelProfile(
    config.transcriptionModelProfilesFile,
    selection.model,
  );
  return new OpenRouterTranscriptionProvider({
    apiKey: requireConfigured(config.openRouterApiKey, "OPENROUTER_API_KEY"),
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

function requireConfigured(value: string | undefined, variableName: string): string {
  if (value === undefined) {
    throw new Error(`${variableName} is required by the provider pinned to this meeting`);
  }
  return value;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
