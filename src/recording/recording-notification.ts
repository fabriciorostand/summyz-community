import { escapeMarkdown } from "discord.js";

import type { AppConfig } from "../config.js";
import type { RecordingManifest } from "./manifest.js";
import type { RecordingStopRequest } from "./recording-coordinator.js";

export interface RecordingText {
  connectionInterrupted: string;
  emptyAfterRestart: string;
  reconnectExhausted: string;
  recoveryExpired: string;
  resumed: string;
  resumeFailed: string;
  resumingAfterRestart: string;
  startFailed: string;
  voiceChannelDeleted: string;
}

const recordingTexts = {
  en: {
    connectionInterrupted:
      "⚠️ Recording was interrupted by a connection problem. Trying to resume automatically.",
    emptyAfterRestart:
      "⚠️ The voice call was empty when resumption was checked. The partial recording was finalized and will be processed.",
    reconnectExhausted:
      "⚠️ Unable to resume recording within five minutes. The captured audio was preserved.",
    recoveryExpired:
      "⚠️ Recording could not resume within 30 minutes. The captured audio was finalized for processing.",
    resumed: "✅ Recording resumed automatically.",
    resumeFailed: "⚠️ Unable to resume recording. The captured audio was preserved.",
    resumingAfterRestart:
      "⚠️ Recording was interrupted. Trying to resume this voice call's recording.",
    startFailed: "⚠️ Unable to start recording. No audio is being captured.",
    voiceChannelDeleted:
      "⚠️ The original voice channel was deleted. The captured audio was finalized for processing. Summyz will try to publish the result in the configured forum.",
  },
  "pt-BR": {
    connectionInterrupted:
      "⚠️ A gravação foi interrompida por um problema de conexão. Tentando retomar automaticamente.",
    emptyAfterRestart:
      "⚠️ A call estava vazia quando a retomada foi verificada. A gravação parcial foi finalizada e será processada.",
    reconnectExhausted:
      "⚠️ Não foi possível retomar a gravação em cinco minutos. O áudio capturado foi preservado.",
    recoveryExpired:
      "⚠️ A gravação não pôde ser retomada em 30 minutos. O áudio capturado foi finalizado para processamento.",
    resumed: "✅ A gravação foi retomada automaticamente.",
    resumeFailed: "⚠️ Não foi possível retomar a gravação. O áudio capturado foi preservado.",
    resumingAfterRestart: "⚠️ A gravação foi interrompida. Tentando retomar a gravação desta call.",
    startFailed: "⚠️ Não foi possível iniciar a gravação. Nenhum áudio está sendo capturado.",
    voiceChannelDeleted:
      "⚠️ O canal de voz original foi excluído. O áudio capturado foi finalizado para processamento. O Summyz tentará publicar o resultado no fórum configurado.",
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
  if (request.reason === "owner_changed") {
    return "⚠️ O dono do servidor mudou. A gravação foi encerrada; o áudio capturado foi preservado para processamento. O resultado será publicado no fórum configurado quando estiver pronto. Novas gravações ficarão bloqueadas.";
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
  if (request.reason === "owner_changed") {
    return "⚠️ The server owner changed. Recording stopped and captured audio was preserved for processing. The result will be published in the configured forum when ready. New recordings are blocked.";
  }
  return undefined;
}
