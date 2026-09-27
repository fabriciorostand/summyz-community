import type { Client } from "discord.js";
import type { Logger } from "pino";

import {
  type AiProfileCompatibilityStatus,
  assessModelCompatibility,
  resolveAiProfile,
} from "./ai-profile.js";
import type { AppConfig } from "./config.js";
import type { CostLedgerStore, CostPhase } from "./cost/cost-ledger.js";
import { ProviderCostRecorder } from "./cost/provider-cost-recorder.js";
import type { AiProfileStore } from "./database/postgres-ai-profile-store.js";
import type { PostgresInstallationHealthStore } from "./database/postgres-installation-health-store.js";
import type { PostgresInstallationSettingsStore } from "./database/postgres-installation-settings-store.js";
import { resolveFasterWhisperBatchSize } from "./local-ai/faster-whisper-batch-size.js";
import type { LocalHardwareProfile } from "./local-ai/hardware-profile.js";
import { type LocalAiPhase, resolveLocalExecutionPlan } from "./local-ai/local-execution-policy.js";
import { LocalModelManager } from "./local-ai/local-model-manager.js";
import { LocalModelInventory } from "./models/local-model-inventory.js";
import type { CachedModelCatalog } from "./models/model-catalog.js";
import { OpenRouterModelPreflight } from "./openrouter/model-preflight.js";
import {
  meetingAiConfigurationSchema,
  type RecordingManifest,
  type ResolvedMeetingAiConfiguration,
  requireCurrentMeetingAiConfiguration,
} from "./recording/manifest.js";
import { FasterWhisperTranscriptionProvider } from "./transcription/faster-whisper-transcription-provider.js";
import { OpenRouterTranscriptionProvider } from "./transcription/openrouter-transcription-provider.js";
import type { TranscriptionModelProfile } from "./transcription/transcription-model-profile.js";
import type { TranscriptionProvider } from "./transcription/transcription-provider.js";

interface ApplicationAiRuntimeOptions {
  aiProfileStore: AiProfileStore;
  client: Client;
  config: AppConfig;
  costStore: CostLedgerStore;
  hardware: LocalHardwareProfile;
  installationSettings: Pick<PostgresInstallationSettingsStore, "getSecret">;
  installationHealth?: Pick<PostgresInstallationHealthStore, "writeHeartbeat">;
  logger: Logger;
  modelCatalogCache?: CachedModelCatalog;
}

export class ApplicationAiRuntime {
  readonly #aiProfileStore: AiProfileStore;
  readonly #client: Client;
  readonly #config: AppConfig;
  readonly #costStore: CostLedgerStore;
  readonly #hardware: LocalHardwareProfile;
  readonly #installationSettings: Pick<PostgresInstallationSettingsStore, "getSecret">;
  readonly #installationHealth: Pick<PostgresInstallationHealthStore, "writeHeartbeat"> | undefined;
  readonly #logger: Logger;
  readonly #modelCatalogCache: CachedModelCatalog | undefined;

  public constructor(options: ApplicationAiRuntimeOptions) {
    this.#aiProfileStore = options.aiProfileStore;
    this.#client = options.client;
    this.#config = options.config;
    this.#costStore = options.costStore;
    this.#hardware = options.hardware;
    this.#installationSettings = options.installationSettings;
    this.#installationHealth = options.installationHealth;
    this.#logger = options.logger;
    this.#modelCatalogCache = options.modelCatalogCache;
  }

  public getMeetingConfiguration(manifest: RecordingManifest): ResolvedMeetingAiConfiguration {
    return requireCurrentMeetingAiConfiguration(manifest);
  }

  public async resolveAndPrepareMeetingConfiguration(
    guildId: string,
  ): Promise<ResolvedMeetingAiConfiguration> {
    return (await this.resolveAndPrepareMeetingProfile(guildId)).configuration;
  }

  public async resolveAndPrepareMeetingProfile(guildId: string): Promise<{
    configuration: ResolvedMeetingAiConfiguration;
    name: string;
    profileId: string;
  }> {
    const profile = await this.#aiProfileStore.getActiveProfile(guildId);
    if (profile === undefined) {
      throw new Error("The server does not have an active AI profile");
    }
    let configuration = meetingAiConfigurationSchema.parse(resolveAiProfile(profile));
    await new LocalModelInventory().requireInstalled(configuration);
    await this.#validateExternalConfiguration(configuration);
    const phases = localPhases(configuration);
    const executionPlan = resolveLocalExecutionPlan({
      device: this.#config.localAiDevice,
      enabledPhases: phases,
      fallback: this.#config.localAiFallback,
      hardware: this.#hardware,
    });
    this.#logExecutionPlan(phases, executionPlan);
    configuration = this.#resolveTranscriptionBatchSize(configuration, executionPlan);
    if (phases.length > 0) {
      await new LocalModelManager({
        batchSize: resolveConfiguredBatchSize(configuration),
        configuration,
        executionPlan,
        logger: this.#logger,
      }).prepare();
      await this.#writeLocalReadiness(configuration);
    }
    return { configuration, name: profile.name, profileId: profile.profileId };
  }

  async #writeLocalReadiness(configuration: ResolvedMeetingAiConfiguration): Promise<void> {
    if (this.#installationHealth === undefined) return;
    const ollamaModels = [configuration.refinement, configuration.summary]
      .filter((phase) => phase.provider === "ollama")
      .map((phase) => phase.model);
    await Promise.all([
      ...(configuration.transcription.provider === "faster-whisper"
        ? [
            this.#installationHealth.writeHeartbeat({
              componentId: "faster-whisper-main",
              componentType: "faster_whisper",
              details: { models: [configuration.transcription.model] },
              status: "ready",
            }),
          ]
        : []),
      ...(ollamaModels.length > 0
        ? [
            this.#installationHealth.writeHeartbeat({
              componentId: "ollama-main",
              componentType: "ollama",
              details: { models: [...new Set(ollamaModels)] },
              status: "ready",
            }),
          ]
        : []),
    ]);
  }

  public async assessActiveProfile(
    guildId: string,
  ): Promise<readonly AiProfileCompatibilityStatus[]> {
    const profile = await this.#aiProfileStore.getActiveProfile(guildId);
    if (profile === undefined) return [];
    const configuration = resolveProfileConfiguration(profile);
    if (configuration === undefined) return [];
    const executionPlan = this.#resolveAssessmentExecutionPlan(configuration);
    if (executionPlan === undefined) return ["incompatible"];
    return assessLocalModels(configuration, executionPlan, this.#hardware);
  }

  public async createTranscriptionProvider(
    selection: ResolvedMeetingAiConfiguration["transcription"],
    manifest: RecordingManifest,
  ): Promise<TranscriptionProvider> {
    if (selection.provider === "faster-whisper") {
      return this.#createFasterWhisperProvider(selection, manifest);
    }
    return this.#createOpenRouterProvider(selection, manifest);
  }

  public createCostRecorder(
    manifest: RecordingManifest,
    phase: CostPhase,
    openRouterApiKey?: string,
  ): ProviderCostRecorder {
    return new ProviderCostRecorder({
      context: { guildId: manifest.guildId, meetingId: manifest.meetingId, phase },
      logger: this.#logger,
      ...(openRouterApiKey === undefined ? {} : { openRouter: { apiKey: openRouterApiKey } }),
      store: this.#costStore,
    });
  }

  public async resolveOpenRouterApiKey(): Promise<string | undefined> {
    return this.#installationSettings.getSecret("openrouter_api_key");
  }

  public async requireOpenRouterApiKey(): Promise<string> {
    return requireConfigured(await this.resolveOpenRouterApiKey(), "OpenRouter API key");
  }

  async #validateExternalConfiguration(
    configuration: ResolvedMeetingAiConfiguration,
  ): Promise<void> {
    if (
      ![configuration.transcription, configuration.refinement, configuration.summary].some(
        (phase) => phase.provider === "openrouter",
      )
    )
      return;
    const apiKey = await this.requireOpenRouterApiKey();
    await new OpenRouterModelPreflight({
      apiKey,
      ...(this.#modelCatalogCache === undefined ? {} : { cache: this.#modelCatalogCache }),
    }).validate({
      generativeModels: [
        ...(configuration.refinement.provider === "openrouter"
          ? [{ model: configuration.refinement.model, phase: "refinement" as const }]
          : []),
        ...(configuration.summary.provider === "openrouter"
          ? [{ model: configuration.summary.model, phase: "summary" as const }]
          : []),
      ],
      ...(configuration.transcription.provider === "openrouter"
        ? { transcriptionModel: configuration.transcription.model }
        : {}),
    });
  }

  #logExecutionPlan(
    phases: readonly LocalAiPhase[],
    executionPlan: ReturnType<typeof resolveLocalExecutionPlan>,
  ): void {
    for (const phase of phases) {
      const execution = executionPlan[phase];
      const details = {
        device: execution.device,
        fallback: execution.fallback,
        fallbackApplied: execution.fallbackApplied,
        ...(execution.gpuVendor === undefined ? {} : { gpuVendor: execution.gpuVendor }),
        phase,
      };
      if (execution.fallbackApplied) {
        this.#logger.warn(
          { ...details, event: "local_ai_cpu_fallback_applied" },
          "Local AI CPU fallback applied",
        );
      } else {
        this.#logger.info(details, "Local AI execution device selected");
      }
    }
  }

  #resolveTranscriptionBatchSize(
    configuration: ResolvedMeetingAiConfiguration,
    executionPlan: ReturnType<typeof resolveLocalExecutionPlan>,
  ): ResolvedMeetingAiConfiguration {
    if (configuration.transcription.provider !== "faster-whisper") return configuration;
    const batchSize = resolveFasterWhisperBatchSize(
      configuration.transcription.batchSize,
      configuration.transcription.model,
      executionPlan.transcription,
      this.#config.transcriptionConcurrency,
    );
    return meetingAiConfigurationSchema.parse({
      ...configuration,
      transcription: { ...configuration.transcription, batchSize },
    });
  }

  #resolveAssessmentExecutionPlan(configuration: ResolvedMeetingAiConfiguration) {
    try {
      return resolveLocalExecutionPlan({
        device: this.#config.localAiDevice,
        enabledPhases: localPhases(configuration),
        fallback: this.#config.localAiFallback,
        hardware: this.#hardware,
      });
    } catch {
      return undefined;
    }
  }

  #createFasterWhisperProvider(
    selection: Extract<
      ResolvedMeetingAiConfiguration["transcription"],
      { provider: "faster-whisper" }
    >,
    manifest: RecordingManifest,
  ): FasterWhisperTranscriptionProvider {
    const executionPlan = resolveLocalExecutionPlan({
      device: this.#config.localAiDevice,
      enabledPhases: ["transcription"],
      fallback: this.#config.localAiFallback,
      hardware: this.#hardware,
    });
    return new FasterWhisperTranscriptionProvider({
      batchSize: typeof selection.batchSize === "number" ? selection.batchSize : 0,
      costRecorder: this.createCostRecorder(manifest, "transcription"),
      device: executionPlan.transcription.device,
      fallback: executionPlan.transcription.fallback,
      language: selection.language,
      model: selection.model,
      prompt: selection.prompt,
      timeoutMs: this.#config.transcriptionTimeoutMs,
      vad: selection.vad,
    });
  }

  async #createOpenRouterProvider(
    selection: Extract<ResolvedMeetingAiConfiguration["transcription"], { provider: "openrouter" }>,
    manifest: RecordingManifest,
  ): Promise<OpenRouterTranscriptionProvider> {
    const profile: TranscriptionModelProfile = {
      interSpeechSilenceMs: selection.interSpeechSilenceMs,
      ...(selection.mergeMaxGapMs === undefined ? {} : { mergeMaxGapMs: selection.mergeMaxGapMs }),
      ...(typeof selection.prompt === "string" ? { prompt: selection.prompt } : {}),
      ...(selection.providerOptions === undefined
        ? {}
        : { providerOptions: selection.providerOptions }),
      ...(selection.temperature === undefined ? {} : { temperature: selection.temperature }),
    };
    const apiKey = await this.requireOpenRouterApiKey();
    return new OpenRouterTranscriptionProvider({
      apiKey,
      costRecorder: this.createCostRecorder(manifest, "transcription", apiKey),
      language: selection.language,
      logger: this.#logger,
      maxAttempts: this.#config.transcriptionMaxAttempts,
      model: selection.model,
      profile,
      retryBaseMs: this.#config.transcriptionRetryBaseMs,
      retryMaxMs: this.#config.transcriptionRetryMaxMs,
      timeoutMs: this.#config.transcriptionTimeoutMs,
    });
  }
}

export function requireConfigured(value: string | undefined, settingName: string): string {
  if (value === undefined) {
    throw new Error(`${settingName} is required by the provider pinned to this meeting`);
  }
  return value;
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

function resolveConfiguredBatchSize(configuration: ResolvedMeetingAiConfiguration): number {
  return configuration.transcription.provider === "faster-whisper" &&
    typeof configuration.transcription.batchSize === "number"
    ? configuration.transcription.batchSize
    : 0;
}

function resolveProfileConfiguration(
  profile: Parameters<typeof resolveAiProfile>[0],
): ResolvedMeetingAiConfiguration | undefined {
  const result = meetingAiConfigurationSchema.safeParse(resolveAiProfile(profile));
  return result.success ? result.data : undefined;
}

function assessLocalModels(
  configuration: ResolvedMeetingAiConfiguration,
  executionPlan: ReturnType<typeof resolveLocalExecutionPlan>,
  hardware: LocalHardwareProfile,
): AiProfileCompatibilityStatus[] {
  return [
    ...(configuration.transcription.provider === "faster-whisper"
      ? [
          assessModelCompatibility({
            device: executionPlan.transcription.device,
            hardware: {
              ...hardware,
              ...(executionPlan.transcription.gpuMemoryBytes === undefined
                ? {}
                : { gpuMemoryBytes: executionPlan.transcription.gpuMemoryBytes }),
            },
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
            hardware: {
              ...hardware,
              ...(executionPlan.refinement.gpuMemoryBytes === undefined
                ? {}
                : { gpuMemoryBytes: executionPlan.refinement.gpuMemoryBytes }),
            },
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
            hardware: {
              ...hardware,
              ...(executionPlan.summary.gpuMemoryBytes === undefined
                ? {}
                : { gpuMemoryBytes: executionPlan.summary.gpuMemoryBytes }),
            },
            model: configuration.summary.model,
            phase: "summary",
            provider: "ollama",
          }),
        ]
      : []),
  ];
}
