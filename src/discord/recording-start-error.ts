import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import { MultilingualCheckpointRequiredError } from "../local-ai/local-model-manager.js";
import { LocalModelsUnavailableError } from "../models/local-model-inventory.js";
import { ModelOperationError } from "../models/model-catalog.js";
import { OpenRouterModelPreflightError } from "../openrouter/model-preflight.js";
import { RecordingAlreadyActiveError } from "../recording/recording-coordinator.js";
import type { InteractionText } from "./interaction-text.js";

export const handleRecordingStartError = async (
  error: unknown,
  interaction: ChatInputCommandInteraction,
  text: InteractionText,
  logger: Logger,
): Promise<boolean> => {
  if (error instanceof ModelOperationError && error.code === "model_lifecycle_busy") {
    await interaction.editReply(lifecycleBusyMessage(text.locale));
    return true;
  }
  if (error instanceof LocalModelsUnavailableError) {
    await interaction.editReply(localModelFailureMessage(error, text.locale));
    return true;
  }
  if (error instanceof RecordingAlreadyActiveError) {
    await interaction.editReply(text.recordingAlreadyActive);
    return true;
  }
  if (error instanceof MultilingualCheckpointRequiredError) {
    await interaction.editReply(text.multilingualCheckpointRequired);
    return true;
  }
  if (error instanceof OpenRouterModelPreflightError) {
    logger.warn(
      {
        guildId: interaction.guildId,
        httpStatus: error.httpStatus,
        phase: error.phase,
        reason: error.reason,
      },
      "OpenRouter model preflight failed",
    );
    await interaction.editReply(preflightFailureMessage(error, text));
    return true;
  }
  return false;
};

function preflightFailureMessage(
  error: OpenRouterModelPreflightError,
  text: InteractionText,
): string {
  switch (error.reason) {
    case "catalog_unavailable":
      return text.modelCatalogUnavailable(error.httpStatus);
    case "catalog_invalid":
      return text.modelCatalogInvalid;
    case "model_missing":
      return error.phase === undefined ? text.commandFailed : text.modelMissing(error.phase);
    case "capability_missing":
      return error.phase === undefined
        ? text.commandFailed
        : text.modelCapabilityMissing(error.phase);
  }
}

function lifecycleBusyMessage(locale: string): string {
  return locale === "pt-BR"
    ? "Há outra operação de modelos ou início de gravação em andamento. Tente iniciar a gravação novamente em instantes."
    : "Another model operation or recording start is in progress. Try starting the recording again shortly.";
}

function localModelFailureMessage(error: LocalModelsUnavailableError, locale: string): string {
  const messages =
    locale === "pt-BR"
      ? {
          missing:
            "A gravação não foi iniciada: faltam modelos locais do perfil ativo. Instale-os pelo painel antes de gravar.",
          unavailable:
            "A gravação não foi iniciada: não foi possível verificar os modelos locais. Verifique os serviços no painel.",
        }
      : {
          missing:
            "Recording did not start: local models required by the active profile are missing. Install them from the dashboard before recording.",
          unavailable:
            "Recording did not start: local model availability could not be verified. Check the services in the dashboard.",
        };
  return error.availability.status === "missing_models" ? messages.missing : messages.unavailable;
}
