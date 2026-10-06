import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import { type CommandLanguage, commandCatalog } from "./command-catalog.js";

export function createCommandDefinitions(language: CommandLanguage) {
  const {
    record,
    recordingActivate,
    recordingProfile,
    recordingRole,
    recordingSummaryForum,
    stop,
  } = commandCatalog;
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

  const recordingProfileCommand = new SlashCommandBuilder()
    .setName(recordingProfile.name)
    .setDescription(recordingProfile.description[language])
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingProfile.subcommands.list.name)
        .setDescription(recordingProfile.subcommands.list.description[language]),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName(recordingProfile.subcommands.set.name)
        .setDescription(recordingProfile.subcommands.set.description[language])
        .addStringOption((option) =>
          option
            .setName(recordingProfile.subcommands.set.options.profile.name)
            .setDescription(recordingProfile.subcommands.set.options.profile.description[language])
            .setRequired(true),
        ),
    );

  const recordingActivateCommand = new SlashCommandBuilder()
    .setName(recordingActivate.name)
    .setDescription(recordingActivate.description[language])
    .setDMPermission(false);

  return [
    recordCommand,
    stopCommand,
    recordingRoleCommand,
    recordingSummaryForumCommand,
    recordingProfileCommand,
    recordingActivateCommand,
  ] as const;
}
