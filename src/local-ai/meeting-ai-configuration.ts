import type { AppConfig } from "../config.js";
import type { MeetingAiConfiguration } from "../recording/manifest.js";
import {
  selectLocalModel,
  type LocalHardwareProfile,
  type LocalModelSelection,
} from "./local-model-selector.js";

export type AiConfigurationConfig = Pick<
  AppConfig,
  | "fasterWhisperModel"
  | "ollamaRefinementModel"
  | "ollamaSummaryModel"
  | "openRouterRefinementModel"
  | "openRouterSummaryModel"
  | "openRouterTranscriptionModel"
  | "refinementProvider"
  | "summaryLanguage"
  | "summaryProvider"
  | "transcriptionLanguage"
  | "transcriptionProvider"
>;

export function createMeetingAiConfiguration(
  config: AiConfigurationConfig,
  hardware: LocalHardwareProfile,
): MeetingAiConfiguration {
  const transcription =
    config.transcriptionProvider === "faster-whisper"
      ? pinSelection(
          selectLocalModel({
            hardware,
            language: config.transcriptionLanguage,
            phase: "transcription",
            requestedModel: config.fasterWhisperModel,
          }),
          config.fasterWhisperModel,
        )
      : remoteSelection(
          requireConfiguredModel(
            config.openRouterTranscriptionModel,
            "OPENROUTER_TRANSCRIPTION_MODEL",
          ),
        );
  const refinement =
    config.refinementProvider === "ollama"
      ? pinSelection(
          selectLocalModel({
            hardware,
            language: "auto",
            phase: "refinement",
            requestedModel: config.ollamaRefinementModel,
          }),
          config.ollamaRefinementModel,
        )
      : remoteSelection(
          requireConfiguredModel(config.openRouterRefinementModel, "OPENROUTER_REFINEMENT_MODEL"),
        );
  const summary =
    config.summaryProvider === "ollama"
      ? pinSelection(
          selectLocalModel({
            hardware,
            language: config.summaryLanguage,
            phase: "summary",
            requestedModel: config.ollamaSummaryModel,
          }),
          config.ollamaSummaryModel,
        )
      : remoteSelection(
          requireConfiguredModel(config.openRouterSummaryModel, "OPENROUTER_SUMMARY_MODEL"),
        );

  return {
    refinement: { ...refinement, provider: config.refinementProvider },
    selectorVersion: 1,
    summary: {
      ...summary,
      language: config.summaryLanguage,
      provider: config.summaryProvider,
    },
    transcription: {
      ...transcription,
      language: config.transcriptionLanguage,
      provider: config.transcriptionProvider,
    },
  };
}

export function hasInsufficientLocalHardware(configuration: MeetingAiConfiguration): boolean {
  return [configuration.transcription, configuration.refinement, configuration.summary].some(
    (phase) => phase.hardwareWarning === true,
  );
}

function remoteSelection(model: string): {
  model: string;
  requestedModel: string;
  status: "selected";
} {
  return { model, requestedModel: model, status: "selected" };
}

function pinSelection(
  selection: LocalModelSelection,
  requestedModel: string,
): {
  hardwareWarning?: true;
  model: string;
  requestedModel: string;
  status: "selected";
} {
  return {
    ...(selection.hardwareWarning === true ? { hardwareWarning: true as const } : {}),
    model: selection.model,
    requestedModel,
    status: "selected",
  };
}

function requireConfiguredModel(model: string | undefined, variableName: string): string {
  if (model === undefined) {
    throw new Error(`${variableName} was not validated before building the meeting configuration`);
  }
  return model;
}
