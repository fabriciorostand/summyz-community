import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import type { AppConfig } from "../config.js";

type BotLanguage = AppConfig["botLanguage"];

const descriptions = {
  en: {
    record: "Starts recording the voice channel you are in",
    recordingRole: "Configures the roles that can control recordings",
    recordingRoleAdd: "Allows a role to start and stop recordings",
    recordingRoleAddOption: "Role that will be authorized",
    recordingRoleList: "Lists the authorized roles in this server",
    recordingRoleRemove: "Removes authorization from a role",
    recordingRoleRemoveOption: "Role that will no longer be authorized",
    summaryForum: "Configures the forum used to publish summaries and transcripts",
    summaryForumClear: "Removes the forum and blocks recordings until another is configured",
    summaryForumSet: "Sets the summary and transcript forum",
    summaryForumSetForum: "Forum that will receive the posts",
    summaryForumSetTag: "Name or ID of an existing forum tag",
    summaryForumShow: "Shows the forum configured in this server",
    stop: "Stops recording the voice channel you are in",
  },
  "pt-br": {
    record: "Inicia a gravação do canal de voz em que você está",
    recordingRole: "Configura os cargos que podem controlar gravações",
    recordingRoleAdd: "Autoriza um cargo a iniciar e encerrar gravações",
    recordingRoleAddOption: "Cargo que será autorizado",
    recordingRoleList: "Lista os cargos autorizados neste servidor",
    recordingRoleRemove: "Remove a autorização de um cargo",
    recordingRoleRemoveOption: "Cargo que deixará de ser autorizado",
    summaryForum: "Configura o fórum usado para publicar resumos e transcrições",
    summaryForumClear: "Remove o fórum e bloqueia novas gravações até outra configuração",
    summaryForumSet: "Define o fórum de resumos e transcrições",
    summaryForumSetForum: "Fórum que receberá as publicações",
    summaryForumSetTag: "Nome ou identificador de uma tag existente no fórum",
    summaryForumShow: "Mostra o fórum configurado neste servidor",
    stop: "Encerra a gravação do canal de voz em que você está",
  },
} as const satisfies Record<BotLanguage, Record<string, string>>;

export function createCommandDefinitions(language: BotLanguage) {
  const text = descriptions[language];
  const recordCommand = new SlashCommandBuilder()
    .setName("record")
    .setDescription(text.record)
    .setDMPermission(false);

  const stopCommand = new SlashCommandBuilder()
    .setName("stop")
    .setDescription(text.stop)
    .setDMPermission(false);

  const recordingRoleCommand = new SlashCommandBuilder()
    .setName("recording-role")
    .setDescription(text.recordingRole)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription(text.recordingRoleAdd)
        .addRoleOption((option) =>
          option.setName("role").setDescription(text.recordingRoleAddOption).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription(text.recordingRoleRemove)
        .addRoleOption((option) =>
          option.setName("role").setDescription(text.recordingRoleRemoveOption).setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("list").setDescription(text.recordingRoleList),
    );

  const recordingSummaryForumCommand = new SlashCommandBuilder()
    .setName("recording-summary-forum")
    .setDescription(text.summaryForum)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription(text.summaryForumSet)
        .addChannelOption((option) =>
          option
            .setName("forum")
            .setDescription(text.summaryForumSetForum)
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option.setName("tag").setDescription(text.summaryForumSetTag).setRequired(false),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName("show").setDescription(text.summaryForumShow))
    .addSubcommand((subcommand) =>
      subcommand.setName("clear").setDescription(text.summaryForumClear),
    );

  return [recordCommand, stopCommand, recordingRoleCommand, recordingSummaryForumCommand] as const;
}
