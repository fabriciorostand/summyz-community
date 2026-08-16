import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

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

export const commandDefinitions = [recordCommand, stopCommand, recordingRoleCommand] as const;
