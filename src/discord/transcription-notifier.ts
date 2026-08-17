import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { RecordingManifest } from "../recording/manifest.js";

export function createTranscriptionFailureMessage(meetingId: string): string {
  return (
    "⚠️ Não foi possível transcrever esta chamada. Nenhuma transcrição será disponibilizada. " +
    `ID: \`${meetingId}\``
  );
}

export async function notifyTranscriptionFailure(
  client: Client,
  logger: Logger,
  manifest: RecordingManifest,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(manifest.notificationChannelId);
    if (channel?.isSendable()) {
      await channel.send({ content: createTranscriptionFailureMessage(manifest.meetingId) });
    }
  } catch (error) {
    logger.warn(
      {
        channelId: manifest.notificationChannelId,
        errorType: error instanceof Error ? error.name : typeof error,
        meetingId: manifest.meetingId,
      },
      "Não foi possível enviar aviso de falha da transcrição",
    );
  }
}
