import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

const recordCommand = new SlashCommandBuilder()
  .setName("record")
  .setDescription("Inicia a gravação do canal de voz em que você está")
  .setDMPermission(false);

const stopCommand = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Encerra a gravação do canal de voz em que você está")
  .setDMPermission(false);

const recordingRoleCommand = new SlashCommandBuilder()
  .setName("recording-role")
  .setDescription("Configura os cargos que podem controlar gravações")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Autoriza um cargo a iniciar e encerrar gravações")
      .addRoleOption((option) =>
        option.setName("role").setDescription("Cargo que será autorizado").setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a autorização de um cargo")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("Cargo que deixará de ser autorizado")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("list").setDescription("Lista os cargos autorizados neste servidor"),
  );

const recordingSummaryForumCommand = new SlashCommandBuilder()
  .setName("recording-summary-forum")
  .setDescription("Configura o fórum usado para publicar resumos e transcrições")
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName("set")
      .setDescription("Define o fórum de resumos e transcrições")
      .addChannelOption((option) =>
        option
          .setName("forum")
          .setDescription("Fórum que receberá as publicações")
          .addChannelTypes(ChannelType.GuildForum)
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("tag")
          .setDescription("Nome ou identificador de uma tag existente no fórum")
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand.setName("show").setDescription("Mostra o fórum configurado neste servidor"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("clear")
      .setDescription("Remove o fórum e bloqueia novas gravações até outra configuração"),
  );

export const commandDefinitions = [
  recordCommand,
  stopCommand,
  recordingRoleCommand,
  recordingSummaryForumCommand,
] as const;
