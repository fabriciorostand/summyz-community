import type { Client } from "discord.js";
import type { Logger } from "pino";

import { type ApplicationAiRuntime, requireConfigured } from "./application-ai-runtime.js";
import type { AppConfig } from "./config.js";
import { PostgresAnalyticsStore } from "./database/postgres-analytics-store.js";
import type { PostgresDatabase } from "./database/postgres-database.js";
import type { PostgresGuildConfigStore } from "./database/postgres-guild-config-store.js";
import { PostgresMeetingAudioCatalog } from "./database/postgres-meeting-audio-catalog.js";
import { PostgresMeetingContentStore } from "./database/postgres-meeting-content-store.js";
import type { PostgresMeetingStore } from "./database/postgres-meeting-store.js";
import { DiscordMeetingPublisher } from "./discord/discord-meeting-publisher.js";
import type { GuildMembershipVerifier } from "./discord/guild-membership-verifier.js";
import { notifyTranscriptionFailure } from "./discord/transcription-notifier.js";
import { LocalModelInventory } from "./models/local-model-inventory.js";
import { DurableJobQueue } from "./processing/durable-job-queue.js";
import { DurableJobWorker } from "./processing/durable-job-worker.js";
import { MeetingArtifactMaintenance } from "./processing/meeting-artifact-maintenance.js";
import { MeetingArtifactRetention } from "./processing/meeting-artifact-retention.js";
import { MeetingFinalizer } from "./processing/meeting-finalizer.js";
import { MeetingProcessingHandler } from "./processing/meeting-processing-handler.js";
import type { ManifestStore } from "./recording/manifest-store.js";
import { MeetingRefinementGenerator } from "./refinement/meeting-refinement-generator.js";
import { MeetingRefinementService } from "./refinement/meeting-refinement-service.js";
import { OllamaRefinementProvider } from "./refinement/ollama-refinement-provider.js";
import { OpenRouterRefinementProvider } from "./refinement/openrouter-refinement-provider.js";
import type { RefinementStore } from "./refinement/refinement-store.js";
import { MeetingSummaryGenerator } from "./summary/meeting-summary-generator.js";
import { MeetingSummaryService } from "./summary/meeting-summary-service.js";
import { OllamaSummaryProvider } from "./summary/ollama-summary-provider.js";
import { OpenRouterSummaryProvider } from "./summary/openrouter-summary-provider.js";
import type { PublicationStore } from "./summary/publication-store.js";
import { resolveSummaryLanguage } from "./summary/summary-language.js";
import type { SummaryStore } from "./summary/summary-store.js";
import { MeetingTranscriptionService } from "./transcription/meeting-transcription-service.js";
import {
  createAudioDecoder,
  FullAudioSpeechAnalyzer,
  SileroSpeechAnalyzer,
} from "./transcription/speech-analyzer.js";
import { CURRENT_TRANSCRIPTION_RECOVERY_VERSION } from "./transcription/transcription-recovery-policy.js";
import type { TranscriptionStore } from "./transcription/transcription-store.js";

interface BotProcessingRuntimeOptions {
  readonly aiRuntime: ApplicationAiRuntime;
  readonly client: Client;
  readonly config: AppConfig;
  readonly database: PostgresDatabase;
  readonly guildConfigStore: PostgresGuildConfigStore;
  readonly logger: Logger;
  readonly manifestStore: ManifestStore;
  readonly membershipVerifier: GuildMembershipVerifier;
  readonly postgresMeetingStore: PostgresMeetingStore;
  readonly publicationStore: PublicationStore;
  readonly refinementStore: RefinementStore;
  readonly summaryStore: SummaryStore;
  readonly transcriptionStore: TranscriptionStore;
}

export function createBotProcessingRuntime(options: BotProcessingRuntimeOptions) {
  const {
    aiRuntime,
    client,
    config,
    database,
    guildConfigStore,
    logger,
    manifestStore,
    membershipVerifier,
    postgresMeetingStore,
    publicationStore,
    refinementStore,
    summaryStore,
    transcriptionStore,
  } = options;
  const meetingPublisher = new DiscordMeetingPublisher({
    canPublish: async (manifest) =>
      (await postgresMeetingStore.isProcessable(manifest.meetingId)) &&
      (await membershipVerifier.check(manifest.guildId)) !== "absent",
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
      if (
        configuration.transcription.provider === "openrouter" &&
        configuration.transcription.vad.enabled
      ) {
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
    checkBotAccess: (guildId) => membershipVerifier.check(guildId),
    requireModels: (manifest) =>
      new LocalModelInventory().requireInstalled(aiRuntime.getMeetingConfiguration(manifest)),
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

  return { artifactMaintenance, postgresQueue, processingHandler, worker };
}
