import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { RecordingManifest } from "../recording/manifest.js";

export function createTranscriptionFailureMessage(
  meetingId: string,
  language: AppConfig["botLanguage"],
): string {
  if (language === "en") {
    return (
      "⚠️ Unable to transcribe this voice call. No transcript will be made available. " +
      `ID: \`${meetingId}\``
    );
  }
  return (
    "⚠️ Não foi possível transcrever esta chamada. Nenhuma transcrição será disponibilizada. " +
    `ID: \`${meetingId}\``
  );
}

export async function notifyTranscriptionFailure(
  client: Client,
  logger: Logger,
  manifest: RecordingManifest,
  language: AppConfig["botLanguage"],
): Promise<void> {
  try {
    const channel = await client.channels.fetch(manifest.notificationChannelId);
    if (channel?.isSendable()) {
      await channel.send({
        content: createTranscriptionFailureMessage(manifest.meetingId, language),
      });
    }
  } catch (error) {
    logger.warn(
      {
        channelId: manifest.notificationChannelId,
        errorType: error instanceof Error ? error.name : typeof error,
        meetingId: manifest.meetingId,
      },
      "Unable to send transcription failure notification",
    );
  }
}
