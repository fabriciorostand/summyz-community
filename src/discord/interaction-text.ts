import type { AppConfig } from "../config.js";

export interface InteractionText {
  aboveRecommendedAiProfile: string;
  authorizedRoles(roleIds: readonly string[]): string;
  cannotConfigureRecordingRoles: string;
  cannotConfigureSummaryForum: string;
  cannotViewCosts: string;
  cannotRecord: string;
  cannotStop: string;
  commandFailed: string;
  configureAiProfileFirst: string;
  configureForumFirst: string;
  forumConfigured(forumId: string, tagName?: string): string;
  forumDisplay(forumId: string, tagId?: string): string;
  forumRequiresTag: string;
  guildOnly: string;
  insufficientForumPermissions: string;
  incompatibleAiProfile: string;
  invalidForum: string;
  joinVoiceFirst: string;
  locale: string;
  noActiveRecording: string;
  noAuthorizedRoles: string;
  noSummaryForum: string;
  openRouterApiKeyMissing: string;
  costInvalidPeriod: string;
  costMeetingInProgress: string;
  costMeetingNotFound: string;
  recordingAlreadyActive: string;
  recordingStarted(voiceChannelName: string, userMention: string, meetingId: string): string;
  roleAuthorized(roleMention: string): string;
  roleRemoved(roleMention: string): string;
  stopProcessed(notificationChannelId: string): string;
  summaryForumCleared: string;
  tagNotFound: string;
  userMustBeInRecordedChannel: string;
  unknownAiProfileCompatibility: string;
}

const texts = {
  en: {
    aboveRecommendedAiProfile:
      "The selected model is above the recommended capacity for the detected hardware. Processing may be very slow or fail because of insufficient memory. Summyz will keep the selected model and will not replace it automatically.",
    authorizedRoles: (roleIds) =>
      `Authorized roles:\n${roleIds.map((roleId) => `- <@&${roleId}>`).join("\n")}`,
    cannotConfigureRecordingRoles: "You cannot configure recording roles.",
    cannotConfigureSummaryForum: "You cannot configure the summary forum.",
    cannotViewCosts: "Only the server owner can view recording costs.",
    cannotRecord: "You do not have an authorized role to start recordings.",
    cannotStop: "You do not have an authorized role to stop recordings.",
    commandFailed: "Unable to complete the command. Please try again.",
    configureForumFirst:
      "Configure a forum with `/recording-summary-forum set` before starting a recording.",
    configureAiProfileFirst:
      "The active processing profile is incomplete. Choose a provider and model for transcription, refinement, and summary before recording.",
    forumConfigured: (forumId, tagName) =>
      "Summary forum configured: <#" +
      forumId +
      ">" +
      (tagName === undefined ? "" : ` with the **${tagName}** tag`) +
      ".",
    forumDisplay: (forumId, tagId) =>
      "Summary forum: <#" +
      forumId +
      ">" +
      (tagId === undefined ? "" : `\nConfigured tag: \`${tagId}\``),
    forumRequiresTag: "This forum requires a tag. Provide the `tag` option in the command.",
    guildOnly: "This command can only be used in a server.",
    insufficientForumPermissions:
      "Summyz does not have all required permissions in this forum: view, create posts, reply, read messages, and attach files.",
    incompatibleAiProfile:
      "The active processing profile contains a model that is incompatible with the selected device. Update the profile before recording.",
    invalidForum: "Select a valid forum channel.",
    joinVoiceFirst: "Join a voice channel before using `/record`.",
    locale: "en",
    noActiveRecording: "There is no active recording in this server.",
    noAuthorizedRoles:
      "No roles have been authorized. Only the server owner can control recordings.",
    noSummaryForum: "No summary forum is configured in this server.",
    openRouterApiKeyMissing:
      "The active profile uses OpenRouter, but OPENROUTER_API_KEY is not configured. Configure the key before recording.",
    costInvalidPeriod: "Use valid dates in YYYY-MM-DD format, with the first date before the last.",
    costMeetingInProgress:
      "Wait for the meeting to end before checking its costs. Processing costs are available after recording ends.",
    costMeetingNotFound: "This completed meeting was not found in this server.",
    recordingAlreadyActive: "There is already an active recording in this server.",
    recordingStarted: (voiceChannelName, userMention, meetingId) =>
      "🔴 Recording started in **" +
      voiceChannelName +
      "** by " +
      userMention +
      ". Participant audio will be recorded. ID: `" +
      meetingId +
      "`",
    roleAuthorized: (roleMention) => `${roleMention} can now control recordings.`,
    roleRemoved: (roleMention) => `${roleMention} can no longer control recordings.`,
    stopProcessed: (notificationChannelId) =>
      `✅ Command processed. The recording was stopped in <#${notificationChannelId}>.`,
    summaryForumCleared:
      "Configuration removed. New recordings will remain blocked until another forum is configured. Meetings not yet published will remain pending.",
    tagNotFound: "The provided tag does not exist in the selected forum.",
    userMustBeInRecordedChannel: "You must be in the channel being recorded to use `/stop`.",
    unknownAiProfileCompatibility:
      "Summyz does not have enough data to evaluate one of the selected models on this hardware. The selection will be kept, but performance and compatibility are not guaranteed.",
  },
  "pt-BR": {
    aboveRecommendedAiProfile:
      "O modelo selecionado está acima da capacidade recomendada para o hardware detectado. O processamento pode ficar muito lento ou falhar por falta de memória. O Summyz manterá sua escolha e não trocará o modelo automaticamente.",
    authorizedRoles: (roleIds) =>
      `Cargos autorizados:\n${roleIds.map((roleId) => `- <@&${roleId}>`).join("\n")}`,
    cannotConfigureRecordingRoles: "Você não pode configurar os cargos de gravação.",
    cannotConfigureSummaryForum: "Você não pode configurar o fórum de resumos.",
    cannotViewCosts: "Somente o dono do servidor pode consultar custos de gravações.",
    cannotRecord: "Você não possui um cargo autorizado para gravar.",
    cannotStop: "Você não possui um cargo autorizado para encerrar.",
    commandFailed: "Não foi possível concluir o comando. Tente novamente.",
    configureForumFirst:
      "Configure um fórum com `/recording-summary-forum set` antes de iniciar uma gravação.",
    configureAiProfileFirst:
      "O perfil de processamento ativo está incompleto. Escolha um provedor e um modelo para transcrição, refinamento e resumo antes de gravar.",
    forumConfigured: (forumId, tagName) =>
      "Fórum de resumos configurado: <#" +
      forumId +
      ">" +
      (tagName === undefined ? "" : ` com a tag **${tagName}**`) +
      ".",
    forumDisplay: (forumId, tagId) =>
      "Fórum de resumos: <#" +
      forumId +
      ">" +
      (tagId === undefined ? "" : `\nTag configurada: \`${tagId}\``),
    forumRequiresTag: "Este fórum exige uma tag. Informe a opção `tag` no comando.",
    guildOnly: "Este comando só pode ser usado em um servidor.",
    insufficientForumPermissions:
      "O Summyz não possui todas as permissões necessárias nesse fórum: visualizar, criar posts, responder, ler mensagens e anexar arquivos.",
    incompatibleAiProfile:
      "O perfil de processamento ativo contém um modelo incompatível com o dispositivo selecionado. Atualize o perfil antes de gravar.",
    invalidForum: "Selecione um canal de fórum válido.",
    joinVoiceFirst: "Entre em um canal de voz antes de usar `/record`.",
    locale: "pt-BR",
    noActiveRecording: "Não existe uma gravação ativa neste servidor.",
    noAuthorizedRoles:
      "Nenhum cargo foi autorizado. Apenas o dono do servidor pode controlar gravações.",
    noSummaryForum: "Nenhum fórum de resumos está configurado neste servidor.",
    openRouterApiKeyMissing:
      "O perfil ativo usa OpenRouter, mas OPENROUTER_API_KEY não está configurada. Configure a chave antes de gravar.",
    costInvalidPeriod:
      "Informe datas válidas no formato AAAA-MM-DD, com a data inicial anterior à final.",
    costMeetingInProgress:
      "Aguarde a reunião terminar para consultar os custos. Os dados ficam disponíveis após o encerramento da gravação.",
    costMeetingNotFound: "Essa reunião concluída não foi encontrada neste servidor.",
    recordingAlreadyActive: "Já existe uma gravação ativa neste servidor.",
    recordingStarted: (voiceChannelName, userMention, meetingId) =>
      "🔴 Gravação iniciada em **" +
      voiceChannelName +
      "** por " +
      userMention +
      ". O áudio dos participantes será gravado. ID: `" +
      meetingId +
      "`",
    roleAuthorized: (roleMention) => `${roleMention} agora pode controlar gravações.`,
    roleRemoved: (roleMention) => `${roleMention} não pode mais controlar gravações.`,
    stopProcessed: (notificationChannelId) =>
      `✅ Comando processado. A gravação foi encerrada em <#${notificationChannelId}>.`,
    summaryForumCleared:
      "Configuração removida. Novas gravações ficarão bloqueadas até que outro fórum seja configurado. Reuniões ainda não publicadas permanecerão pendentes.",
    tagNotFound: "A tag informada não existe no fórum selecionado.",
    userMustBeInRecordedChannel:
      "Você precisa estar no canal que está sendo gravado para usar `/stop`.",
    unknownAiProfileCompatibility:
      "O Summyz não possui dados suficientes para avaliar um dos modelos selecionados neste hardware. A escolha será mantida, mas desempenho e compatibilidade não são garantidos.",
  },
} satisfies Record<AppConfig["botLanguage"], InteractionText>;

export function getInteractionText(language: AppConfig["botLanguage"]): InteractionText {
  return texts[language];
}
