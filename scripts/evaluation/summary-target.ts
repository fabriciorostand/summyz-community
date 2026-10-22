import { createHash } from "node:crypto";
import { composeProtectedPrompt } from "summyz-community-bot/ai-system-prompt";
import type { BootstrapConfig } from "summyz-community-bot/config";
import { MeetingSummaryGenerator } from "summyz-community-bot/summary/meeting-summary-generator";
import { OllamaSummaryProvider } from "summyz-community-bot/summary/ollama-summary-provider";
import { OpenRouterSummaryProvider } from "summyz-community-bot/summary/openrouter-summary-provider";
import { resolveSummaryLanguage } from "summyz-community-bot/summary/summary-language";
import { type AiProfile, resolveAiProfile } from "summyz-community-shared/ai-profile";
import { PostgresAiProfileStore } from "summyz-community-shared/database/postgres-ai-profile-store";
import type { PostgresDatabase } from "summyz-community-shared/database/postgres-database";
import { PostgresInstallationSettingsStore } from "summyz-community-shared/database/postgres-installation-settings-store";
import type { SecretBox } from "summyz-community-shared/security/secret-box";

export async function readEvaluationInstallation(
  database: Pick<PostgresDatabase, "transaction" | "close">,
  secretBox: SecretBox,
  profileId?: string,
) {
  try {
    return await database.transaction(async (executor) => {
      await executor.query("SET TRANSACTION READ ONLY");
      const profiles = await new PostgresAiProfileStore(executor).listProfiles();
      if (profileId === undefined) return { profiles };
      const profile = profiles.find((item) => item.profileId === profileId);
      if (profile === undefined) throw new Error("Evaluation profile is unavailable");
      const apiKey =
        profile.summary.provider === "openrouter"
          ? await new PostgresInstallationSettingsStore({
              database: executor,
              secretBox,
            }).getSecret("openrouter_api_key")
          : undefined;
      return { profiles, apiKey };
    });
  } finally {
    await database.close();
  }
}

function resolveDevice(configured: "auto" | "cpu" | "gpu" | undefined, requested?: "cpu" | "gpu") {
  if (configured === undefined) {
    if (requested !== undefined)
      throw new Error("External profiles do not support a device override");
    return null;
  }
  if (configured === "auto") {
    if (requested === undefined)
      throw new Error("Automatic profiles require --device cpu or --device gpu");
    return requested;
  }
  if (requested !== undefined && requested !== configured)
    throw new Error("Device conflicts with the selected profile");
  return configured;
}

export function createEvaluationTarget(options: {
  profile: AiProfile;
  config: BootstrapConfig;
  apiKey?: string | undefined;
  device?: "cpu" | "gpu" | undefined;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const configuration = resolveAiProfile(options.profile);
  const selection = configuration.summary;
  const language = resolveSummaryLanguage({
    detectedLanguage: "pt-BR",
    summaryLanguage: configuration.language,
    transcriptionLanguage: configuration.transcription.language,
  });
  const device = resolveDevice(selection.device, options.device);
  const providerOptions = {
    consolidationPrompt: selection.consolidationPrompt,
    extractionPrompt: selection.extractionPrompt,
    generation: selection.generation,
    language,
    model: selection.model,
    timeoutMs: options.config.summaryTimeoutMs,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  const provider =
    selection.provider === "ollama"
      ? new OllamaSummaryProvider({
          ...providerOptions,
          baseUrl: device === "gpu" ? "http://ollama-gpu:11434" : "http://ollama:11434",
          ...(device === null ? {} : { device }),
        })
      : createExternalProvider(providerOptions, options);
  return {
    generator: new MeetingSummaryGenerator({
      maxChunkCharacters: selection.maxChunkCharacters,
      provider,
    }),
    metadata: {
      profileId: options.profile.profileId,
      provider: selection.provider,
      model: selection.model,
      generation: selection.generation,
      language,
      device,
      maxChunkCharacters: selection.maxChunkCharacters,
      promptSha256: createHash("sha256")
        .update(
          JSON.stringify({
            extraction: composeProtectedPrompt({
              editablePrompt: selection.extractionPrompt,
              phase: "summary",
              phaseLanguage: language,
            }),
            consolidation: composeProtectedPrompt({
              editablePrompt: selection.consolidationPrompt,
              phase: "summary",
              phaseLanguage: language,
            }),
          }),
        )
        .digest("hex"),
    },
  };
}

function createExternalProvider(
  providerOptions: Pick<
    ConstructorParameters<typeof OpenRouterSummaryProvider>[0],
    | "consolidationPrompt"
    | "extractionPrompt"
    | "generation"
    | "language"
    | "model"
    | "timeoutMs"
    | "fetch"
  >,
  options: { apiKey?: string | undefined; config: BootstrapConfig },
) {
  if (options.apiKey === undefined || options.apiKey.trim().length === 0) {
    throw new Error("The selected profile requires a configured OpenRouter credential");
  }
  return new OpenRouterSummaryProvider({
    ...providerOptions,
    apiKey: options.apiKey,
    maxAttempts: options.config.summaryMaxAttempts,
    retryBaseMs: options.config.summaryRetryBaseMs,
    retryMaxMs: options.config.summaryRetryMaxMs,
  });
}
