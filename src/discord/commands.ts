import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { type CommandLanguage, commandCatalog } from "./command-catalog.js";

export function createCommandDefinitions(language: CommandLanguage) {
  const { record, recordingCost, recordingRole, recordingSummaryForum, stop } = commandCatalog;
  const recordCommand = new SlashCommandBuilder()
    .setName(record.name)
    .setDescription(record.description[language])
    .setDMPermission(false);

  const stopCommand = new SlashCommandBuilder()
    .setName(stop.name)
    .setDescription(stop.description[language])
    .setDMPermission(false);

  const recordingRoleCommand = new SlashCommandBuilder()
    .setName(recordingRole.name)
    .setDescription(recordingRole.description[language])
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingRole.subcommands.add.name)
        .setDescription(recordingRole.subcommands.add.description[language])
        .addRoleOption((option) =>
          option
            .setName(recordingRole.subcommands.add.options.role.name)
            .setDescription(recordingRole.subcommands.add.options.role.description[language])
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingRole.subcommands.remove.name)
        .setDescription(recordingRole.subcommands.remove.description[language])
        .addRoleOption((option) =>
          option
            .setName(recordingRole.subcommands.remove.options.role.name)
            .setDescription(recordingRole.subcommands.remove.options.role.description[language])
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingRole.subcommands.list.name)
        .setDescription(recordingRole.subcommands.list.description[language]),
    );

  const recordingSummaryForumCommand = new SlashCommandBuilder()
    .setName(recordingSummaryForum.name)
    .setDescription(recordingSummaryForum.description[language])
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingSummaryForum.subcommands.set.name)
        .setDescription(recordingSummaryForum.subcommands.set.description[language])
        .addChannelOption((option) =>
          option
            .setName(recordingSummaryForum.subcommands.set.options.forum.name)
            .setDescription(
              recordingSummaryForum.subcommands.set.options.forum.description[language],
            )
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName(recordingSummaryForum.subcommands.set.options.tag.name)
            .setDescription(recordingSummaryForum.subcommands.set.options.tag.description[language])
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingSummaryForum.subcommands.show.name)
        .setDescription(recordingSummaryForum.subcommands.show.description[language]),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingSummaryForum.subcommands.clear.name)
        .setDescription(recordingSummaryForum.subcommands.clear.description[language]),
    );

  const recordingCostCommand = new SlashCommandBuilder()
    .setName(recordingCost.name)
    .setDescription(recordingCost.description[language])
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingCost.subcommands.meeting.name)
        .setDescription(recordingCost.subcommands.meeting.description[language])
        .addStringOption((option) =>
          option
            .setName(recordingCost.subcommands.meeting.options.id.name)
            .setDescription(recordingCost.subcommands.meeting.options.id.description[language])
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingCost.subcommands.period.name)
        .setDescription(recordingCost.subcommands.period.description[language])
        .addStringOption((option) =>
          option
            .setName(recordingCost.subcommands.period.options.from.name)
            .setDescription(recordingCost.subcommands.period.options.from.description[language])
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName(recordingCost.subcommands.period.options.to.name)
            .setDescription(recordingCost.subcommands.period.options.to.description[language])
            .setRequired(true),
        ),
    );

  return [
    recordCommand,
    stopCommand,
    recordingRoleCommand,
    recordingSummaryForumCommand,
    recordingCostCommand,
  ] as const;
}
