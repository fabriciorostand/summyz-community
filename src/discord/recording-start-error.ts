import type { ChatInputCommandInteraction } from "discord.js";
import type { Logger } from "pino";

import { MultilingualCheckpointRequiredError } from "../local-ai/local-model-manager.js";
import { OpenRouterModelPreflightError } from "../openrouter/model-preflight.js";
import { RecordingAlreadyActiveError } from "../recording/recording-coordinator.js";
import type { InteractionText } from "./interaction-text.js";

export const handleRecordingStartError = async (
  error: unknown,
  interaction: ChatInputCommandInteraction,
  text: InteractionText,
  logger: Logger,
): Promise<boolean> => {
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
    let message: string;
    switch (error.reason) {
      case "catalog_unavailable":
        message = text.modelCatalogUnavailable(error.httpStatus);
        break;
      case "catalog_invalid":
        message = text.modelCatalogInvalid;
        break;
      case "model_missing":
        message = error.phase === undefined ? text.commandFailed : text.modelMissing(error.phase);
        break;
      case "capability_missing":
        message =
          error.phase === undefined ? text.commandFailed : text.modelCapabilityMissing(error.phase);
        break;
    }
    await interaction.editReply(message);
    return true;
  }
  return false;
};
