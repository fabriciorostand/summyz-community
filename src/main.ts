import { existsSync } from "node:fs";
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
import { OpenRouterRefinementProvider } from "./refinement/openrouter-refinement-provider.js";
import { RefinementStore } from "./refinement/refinement-store.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import type { RecordingManifest } from "./recording/manifest.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";
import { MeetingSummaryGenerator } from "./summary/meeting-summary-generator.js";
import { MeetingSummaryService } from "./summary/meeting-summary-service.js";
import { OpenRouterSummaryProvider } from "./summary/openrouter-summary-provider.js";
import { PublicationStore } from "./summary/publication-store.js";
import { SummaryStore } from "./summary/summary-store.js";
import { configureTerminalEncoding } from "./terminal-encoding.js";
import { MeetingTranscriptionService } from "./transcription/meeting-transcription-service.js";
import { OpenRouterTranscriptionProvider } from "./transcription/openrouter-transcription-provider.js";
import { SileroSpeechAnalyzer } from "./transcription/speech-analyzer.js";
import {
  loadTranscriptionModelProfile,
  type TranscriptionModelProfile,
} from "./transcription/transcription-model-profile.js";
import { TranscriptionStore } from "./transcription/transcription-store.js";

const terminalEncoding = configureTerminalEncoding();

if (existsSync(".env")) {
  loadEnvFile(".env");
}

let config: ReturnType<typeof loadConfig>;
let transcriptionModelProfile: TranscriptionModelProfile;
try {
  config = loadConfig(process.env);
  transcriptionModelProfile = await loadTranscriptionModelProfile(
    config.transcriptionModelProfilesFile,
    config.openRouterTranscriptionModel,
  );
} catch {
  console.error("Configuração inválida. Revise o .env e os perfis de modelos de transcrição.");
  process.exitCode = 1;
  throw new Error("Configuração inválida");
}

const logger = createLogger(config.logLevel);
if (!terminalEncoding.configured) {
  logger.warn(
    { errorType: terminalEncoding.errorType },
    "Não foi possível configurar o terminal do Windows para UTF-8",
  );
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
  logger.fatal(
    { errorType: getErrorType(error) },
    "Não foi possível ler as reuniões armazenadas no disco",
  );
  process.exit(1);
}

const postgresRequired = requiresPostgres(config.storageMode, startupManifests);
let database: PostgresDatabase | undefined;
if (postgresRequired) {
  if (config.databaseUrl === undefined) {
    logger.fatal(
      "DATABASE_URL é obrigatória: há uma reunião PostgreSQL pendente ou STORAGE_MODE=postgres.",
    );
    process.exit(1);
  }
  const candidate = createPostgresDatabase(config.databaseUrl);
  try {
    await candidate.initialize();
    database = candidate;
    logger.info("PostgreSQL inicializado");
  } catch (error) {
    logger.fatal(
      { errorType: getErrorType(error) },
      "Não foi possível inicializar o PostgreSQL. Verifique DATABASE_URL e a disponibilidade do banco.",
    );
    await candidate.close().catch(() => undefined);
    process.exit(1);
  }
} else {
  logger.info("Armazenamento local inicializado sem PostgreSQL");
}

const postgresMeetingStore =
  database === undefined ? undefined : new PostgresMeetingStore(database);
const manifestStore = new ManifestStore(recordingsDirectory, postgresMeetingStore);
const localQueue = new LocalDurableJobQueue(join(config.dataDir, "processing.json"));
try {
  await localQueue.initialize();
} catch (error) {
  logger.fatal({ errorType: getErrorType(error) }, "Não foi possível inicializar a fila local");
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
const summaryProvider = new OpenRouterSummaryProvider({
  apiKey: config.openRouterApiKey,
  logger,
  maxAttempts: config.summaryMaxAttempts,
  model: config.openRouterSummaryModel,
  retryBaseMs: config.summaryRetryBaseMs,
  retryMaxMs: config.summaryRetryMaxMs,
  timeoutMs: config.summaryTimeoutMs,
});
const summaryGenerator = new MeetingSummaryGenerator({
  maxChunkCharacters: config.summaryChunkMaxCharacters,
  provider: summaryProvider,
});
const meetingPublisher = new DiscordMeetingPublisher({
  client,
  guildConfigStore,
  logger,
  store: publicationStore,
  timeZone: config.summaryTimeZone,
});
const summaryService = new MeetingSummaryService({
  generator: summaryGenerator,
  logger,
  publisher: meetingPublisher,
  refinementStore,
  summaryStore,
  transcriptionStore,
});
const refinementProvider = new OpenRouterRefinementProvider({
  apiKey: config.openRouterApiKey,
  logger,
  maxAttempts: config.refinementMaxAttempts,
  model: config.openRouterRefinementModel,
  retryBaseMs: config.refinementRetryBaseMs,
  retryMaxMs: config.refinementRetryMaxMs,
  timeoutMs: config.refinementTimeoutMs,
});
const refinementGenerator = new MeetingRefinementGenerator({
  maxChunkCharacters: config.refinementChunkMaxCharacters,
  provider: refinementProvider,
});
const refinementService = new MeetingRefinementService({
  generator: refinementGenerator,
  logger,
  refinementStore,
  transcriptionStore,
});
const transcriptionProvider = new OpenRouterTranscriptionProvider({
  apiKey: config.openRouterApiKey,
  logger,
  maxAttempts: config.transcriptionMaxAttempts,
  model: config.openRouterTranscriptionModel,
  profile: transcriptionModelProfile,
  retryBaseMs: config.transcriptionRetryBaseMs,
  retryMaxMs: config.transcriptionRetryMaxMs,
  timeoutMs: config.transcriptionTimeoutMs,
});
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
  notifyFailure: (manifest) => notifyTranscriptionFailure(client, logger, manifest),
  provider: transcriptionProvider,
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
);
const coordinator = new RecordingCoordinator(recordingFactory);

installInteractionHandler(client, guildConfigStore, coordinator, logger);
installVoiceStateHandler(client, coordinator, logger);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ botUserId: readyClient.user.id }, "Summyz conectado ao Discord");
  try {
    await registerCommands(config);
    logger.info(
      { registrationScope: config.discordGuildId === undefined ? "global" : "guild" },
      "Comandos registrados",
    );
  } catch (error) {
    logger.error({ errorType: getErrorType(error) }, "Falha ao registrar comandos");
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
    logger.error({ errorType: getErrorType(error) }, "Falha ao recuperar gravações anteriores");
  }

  try {
    for (const manifest of await manifestStore.listCompleted()) {
      // Sincroniza primeiro o backend fixado no manifesto e só então reconcilia o job.
      await manifestStore.save(manifest);
      await enqueueCompleted(manifest);
    }
  } catch (error) {
    logger.error(
      { errorType: getErrorType(error) },
      "Falha ao reconciliar reuniões concluídas com a fila durável",
    );
  }
  for (const worker of workers) worker.start();
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Encerramento do Summyz solicitado");
  await coordinator.shutdown();
  await Promise.all(workers.map(async (worker) => worker.shutdown()));
  try {
    await speechAnalyzer.close();
  } catch (error) {
    logger.error(
      { errorType: getErrorType(error) },
      "Não foi possível encerrar o detector local de voz",
    );
  }
  client.destroy();
  await database?.close().catch((error: unknown) => {
    logger.error(
      { errorType: getErrorType(error) },
      "Não foi possível encerrar a conexão com o PostgreSQL",
    );
  });
  logger.info("Summyz encerrado");
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
  logger.fatal({ errorType: getErrorType(error) }, "Não foi possível conectar o Summyz ao Discord");
  await Promise.all(workers.map(async (worker) => worker.shutdown()));
  await speechAnalyzer.close().catch(() => undefined);
  await database?.close().catch(() => undefined);
  process.exitCode = 1;
}

function requireDatabase(value: PostgresDatabase | undefined): PostgresDatabase {
  if (value === undefined) throw new Error("PostgreSQL não foi inicializado");
  return value;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
