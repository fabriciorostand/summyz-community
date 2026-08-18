import { escapeMarkdown } from "discord.js";

import type { RecordingManifest } from "./manifest.js";
import type { RecordingStopRequest } from "./recording-coordinator.js";

export function createRecordingStopNotification(
  manifest: Pick<RecordingManifest, "voiceChannelName">,
  request: RecordingStopRequest,
): string | undefined {
  if (request.reason === "command") {
    return `⏹️ Gravação encerrada por <@${request.stoppedByUserId}>. Os segmentos de áudio foram preservados.`;
  }
  if (request.reason === "channel_empty") {
    const channelDescription =
      manifest.voiceChannelName === undefined
        ? "do canal de voz"
        : `de **${escapeMarkdown(manifest.voiceChannelName)}**`;
    return (
      `⏹️ Todos os participantes saíram ${channelDescription}. ` +
      "A gravação foi encerrada automaticamente. " +
      "Os segmentos de áudio foram preservados e serão processados."
    );
  }
  if (request.reason === "shutdown") {
    return "⚠️ O Summyz foi desligado durante a call. O áudio foi preservado e a retomada ocorrerá no próximo início.";
  }
  return undefined;
}
