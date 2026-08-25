import { escapeMarkdown } from "discord.js";

import type { AppConfig } from "../config.js";
import type { RecordingManifest } from "./manifest.js";
import type { RecordingStopRequest } from "./recording-coordinator.js";

export interface RecordingText {
  connectionInterrupted: string;
  emptyAfterRestart: string;
  reconnectExhausted: string;
  resumed: string;
  resumeFailed: string;
  resumingAfterRestart: string;
  startFailed: string;
}

const recordingTexts = {
  en: {
    connectionInterrupted:
      "⚠️ Recording was interrupted by a connection problem. Trying to resume automatically.",
    emptyAfterRestart:
      "⚠️ The voice call was empty after the restart. The partial recording was finalized and will be processed.",
    reconnectExhausted:
      "⚠️ Unable to resume recording within five minutes. The captured audio was preserved.",
    resumed: "✅ Recording resumed automatically.",
    resumeFailed: "⚠️ Unable to resume recording. The captured audio was preserved.",
    resumingAfterRestart: "⚠️ Summyz was interrupted. Trying to resume this voice call's recording.",
    startFailed: "⚠️ Unable to start recording. No audio is being captured.",
  },
  "pt-br": {
    connectionInterrupted:
      "⚠️ A gravação foi interrompida por um problema de conexão. Tentando retomar automaticamente.",
    emptyAfterRestart:
      "⚠️ A call estava vazia após o reinício. A gravação parcial foi finalizada e será processada.",
    reconnectExhausted:
      "⚠️ Não foi possível retomar a gravação em cinco minutos. O áudio capturado foi preservado.",
    resumed: "✅ A gravação foi retomada automaticamente.",
    resumeFailed: "⚠️ Não foi possível retomar a gravação. O áudio capturado foi preservado.",
    resumingAfterRestart: "⚠️ O Summyz foi interrompido. Tentando retomar a gravação desta call.",
    startFailed: "⚠️ Não foi possível iniciar a gravação. Nenhum áudio está sendo capturado.",
  },
} as const satisfies Record<AppConfig["botLanguage"], RecordingText>;

export function getRecordingText(language: AppConfig["botLanguage"]): RecordingText {
  return recordingTexts[language];
}

export function createRecordingStopNotification(
  manifest: Pick<RecordingManifest, "voiceChannelName">,
  request: RecordingStopRequest,
  language: AppConfig["botLanguage"],
): string | undefined {
  if (language === "en") {
    return createEnglishNotification(manifest, request);
  }
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

function createEnglishNotification(
  manifest: Pick<RecordingManifest, "voiceChannelName">,
  request: RecordingStopRequest,
): string | undefined {
  if (request.reason === "command") {
    return (
      "⏹️ Recording stopped by <@" +
      request.stoppedByUserId +
      ">. The audio segments were preserved."
    );
  }
  if (request.reason === "channel_empty") {
    const channelDescription =
      manifest.voiceChannelName === undefined
        ? "the voice channel"
        : `**${escapeMarkdown(manifest.voiceChannelName)}**`;
    return (
      "⏹️ All participants left " +
      channelDescription +
      ". " +
      "The recording was stopped automatically. " +
      "The audio segments were preserved and will be processed."
    );
  }
  if (request.reason === "shutdown") {
    return "⚠️ Summyz was shut down during the voice call. The audio was preserved and recording will resume on the next startup.";
  }
  return undefined;
}
