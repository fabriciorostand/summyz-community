import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { join } from "node:path";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
import { DiscordMeetingPublisher } from "./discord/discord-meeting-publisher.js";
import { installInteractionHandler } from "./discord/interaction-handler.js";
import { registerCommands } from "./discord/register-commands.js";
import { installVoiceStateHandler } from "./discord/voice-state-handler.js";
import { notifyTranscriptionFailure } from "./discord/transcription-notifier.js";
import { GuildConfigStore } from "./guild-config-store.js";
import { createLogger } from "./logger.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";
import { configureTerminalEncoding } from "./terminal-encoding.js";
import { MeetingSummaryGenerator } from "./summary/meeting-summary-generator.js";
import { MeetingSummaryService } from "./summary/meeting-summary-service.js";
import { OpenRouterSummaryProvider } from "./summary/openrouter-summary-provider.js";
import { PublicationStore } from "./summary/publication-store.js";
import { SummaryCoordinator } from "./summary/summary-coordinator.js";
import { SummaryStore } from "./summary/summary-store.js";
import { FailedRecordingRetention } from "./transcription/failed-recording-retention.js";
import { MeetingTranscriptionService } from "./transcription/meeting-transcription-service.js";
import { OpenRouterTranscriptionProvider } from "./transcription/openrouter-transcription-provider.js";
import { SileroSpeechAnalyzer } from "./transcription/speech-analyzer.js";
import { TranscriptionCoordinator } from "./transcription/transcription-coordinator.js";
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
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const guildConfigStore = new GuildConfigStore(join(config.dataDir, "config", "guilds.json"));
const manifestStore = new ManifestStore(join(config.dataDir, "recordings"));
const transcriptionStore = new TranscriptionStore(join(config.dataDir, "recordings"));
const summaryStore = new SummaryStore(join(config.dataDir, "recordings"));
const publicationStore = new PublicationStore(join(config.dataDir, "recordings"));
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
  logger,
  store: publicationStore,
  timeZone: config.summaryTimeZone,
});
const summaryService = new MeetingSummaryService({
  generator: summaryGenerator,
  logger,
  publisher: meetingPublisher,
  summaryStore,
  transcriptionStore,
});
const summaryCoordinator = new SummaryCoordinator(summaryService, logger);
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
  onCompleted: (manifest) => {
    summaryCoordinator.start(manifest);
  },
  provider: transcriptionProvider,
  speechAnalyzer,
  transcriptionStore,
  transcriptionMergeMaxGapMs:
    transcriptionModelProfile.mergeMaxGapMs ?? config.transcriptionMergeMaxGapMs,
  transcriptionWindowMaxMs: config.transcriptionWindowMaxSeconds * 1_000,
});
const transcriptionCoordinator = new TranscriptionCoordinator(transcriptionService, logger);
const failedRecordingRetention = new FailedRecordingRetention({
  logger,
  retentionHours: config.failedRecordingRetentionHours,
  store: transcriptionStore,
});
const recordingFactory = new DiscordRecordingFactory(
  client,
  config,
  manifestStore,
  logger,
  (manifest) => {
    transcriptionCoordinator.start(manifest);
  },
);
const coordinator = new RecordingCoordinator(recordingFactory);
failedRecordingRetention.start();

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
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Falha ao registrar comandos",
    );
  }

  try {
    const recoverableManifests = await manifestStore.listRecoverable();
    for (const manifest of recoverableManifests) {
      await coordinator.resume(manifest);
    }
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Falha ao recuperar gravações anteriores",
    );
  }

  try {
    const completedManifests = await manifestStore.listCompleted();
    for (const manifest of completedManifests) {
      summaryCoordinator.start(manifest);
    }
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Falha ao recuperar resumos ou publicações anteriores",
    );
  }
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Encerramento do Summyz solicitado");
  await coordinator.shutdown();
  await transcriptionCoordinator.shutdown();
  await summaryCoordinator.shutdown();
  try {
    await speechAnalyzer.close();
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Não foi possível encerrar o detector local de voz",
    );
  }
  failedRecordingRetention.stop();
  client.destroy();
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
  logger.fatal(
    { errorType: error instanceof Error ? error.name : typeof error },
    "Não foi possível conectar o Summyz ao Discord",
  );
  process.exitCode = 1;
}
