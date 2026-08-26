import type { AppConfig } from "../config.js";

export interface InteractionText {
  authorizedRoles(roleIds: readonly string[]): string;
  cannotConfigureRecordingRoles: string;
  cannotConfigureSummaryForum: string;
  cannotRecord: string;
  cannotStop: string;
  commandFailed: string;
  configureForumFirst: string;
  forumConfigured(forumId: string, tagName?: string): string;
  forumDisplay(forumId: string, tagId?: string): string;
  forumRequiresTag: string;
  guildOnly: string;
  insufficientForumPermissions: string;
  insufficientLocalHardware: string;
  invalidForum: string;
  joinVoiceFirst: string;
  locale: string;
  noActiveRecording: string;
  noAuthorizedRoles: string;
  noSummaryForum: string;
  recordingAlreadyActive: string;
  recordingStarted(voiceChannelName: string, userMention: string, meetingId: string): string;
  roleAuthorized(roleMention: string): string;
  roleRemoved(roleMention: string): string;
  stopProcessed(notificationChannelId: string): string;
  summaryForumCleared: string;
  tagNotFound: string;
  userMustBeInRecordedChannel: string;
}

const texts = {
  en: {
    authorizedRoles: (roleIds) =>
      `Authorized roles:\n${roleIds.map((roleId) => `- <@&${roleId}>`).join("\n")}`,
    cannotConfigureRecordingRoles: "You cannot configure recording roles.",
    cannotConfigureSummaryForum: "You cannot configure the summary forum.",
    cannotRecord: "You do not have an authorized role to start recordings.",
    cannotStop: "You do not have an authorized role to stop recordings.",
    commandFailed: "Unable to complete the command. Please try again.",
    configureForumFirst:
      "Configure a forum with `/recording-summary-forum set` before starting a recording.",
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
    insufficientLocalHardware:
      "This machine is below the hardware recommendation for the selected fully local setup. Summyz will still process the recording with the smallest compatible local models, but processing may be slow and output quality may be lower than desired. Consider configuring OpenRouter.",
    invalidForum: "Select a valid forum channel.",
    joinVoiceFirst: "Join a voice channel before using `/record`.",
    locale: "en",
    noActiveRecording: "There is no active recording in this server.",
    noAuthorizedRoles: "No roles have been authorized. Only administrators can control recordings.",
    noSummaryForum: "No summary forum is configured in this server.",
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
  },
  "pt-br": {
    authorizedRoles: (roleIds) =>
      `Cargos autorizados:\n${roleIds.map((roleId) => `- <@&${roleId}>`).join("\n")}`,
    cannotConfigureRecordingRoles: "Você não pode configurar os cargos de gravação.",
    cannotConfigureSummaryForum: "Você não pode configurar o fórum de resumos.",
    cannotRecord: "Você não possui um cargo autorizado para gravar.",
    cannotStop: "Você não possui um cargo autorizado para encerrar.",
    commandFailed: "Não foi possível concluir o comando. Tente novamente.",
    configureForumFirst:
      "Configure um fórum com `/recording-summary-forum set` antes de iniciar uma gravação.",
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
    insufficientLocalHardware:
      "Este computador está abaixo da recomendação de hardware para a configuração 100% local selecionada. O processamento será tentado com os menores modelos locais compatíveis, mas pode ser lento e a qualidade do resultado pode ficar abaixo do desejado. Considere configurar o OpenRouter.",
    invalidForum: "Selecione um canal de fórum válido.",
    joinVoiceFirst: "Entre em um canal de voz antes de usar `/record`.",
    locale: "pt-BR",
    noActiveRecording: "Não existe uma gravação ativa neste servidor.",
    noAuthorizedRoles:
      "Nenhum cargo foi autorizado. Apenas administradores podem controlar gravações.",
    noSummaryForum: "Nenhum fórum de resumos está configurado neste servidor.",
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
  },
} satisfies Record<AppConfig["botLanguage"], InteractionText>;

export function getInteractionText(language: AppConfig["botLanguage"]): InteractionText {
  return texts[language];
}
