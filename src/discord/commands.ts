import {
  ChannelType,
  Locale,
  PermissionFlagsBits,
  type SharedNameAndDescription,
  SlashCommandBuilder,
} from "discord.js";

import { commandCatalog, type LocalizedText } from "./command-catalog.js";

/** English is the default; Discord shows the pt-BR text to members whose client uses it. */
function describe<T extends SharedNameAndDescription>(builder: T, text: LocalizedText): T {
  return builder
    .setDescription(text.en)
    .setDescriptionLocalizations({ [Locale.PortugueseBR]: text["pt-BR"] });
}

export function createCommandDefinitions() {
  const {
    record,
    recordingActivate,
    recordingProfile,
    recordingRole,
    recordingSummaryForum,
    stop,
  } = commandCatalog;
  const recordCommand = describe(
    new SlashCommandBuilder().setName(record.name),
    record.description,
  ).setDMPermission(false);

  const stopCommand = describe(
    new SlashCommandBuilder().setName(stop.name),
    stop.description,
  ).setDMPermission(false);

  const recordingRoleCommand = describe(
    new SlashCommandBuilder().setName(recordingRole.name),
    recordingRole.description,
  )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingRole.subcommands.add.name),
        recordingRole.subcommands.add.description,
      ).addRoleOption((option) =>
        describe(
          option.setName(recordingRole.subcommands.add.options.role.name),
          recordingRole.subcommands.add.options.role.description,
        ).setRequired(true),
      ),
    )
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingRole.subcommands.remove.name),
        recordingRole.subcommands.remove.description,
      ).addRoleOption((option) =>
        describe(
          option.setName(recordingRole.subcommands.remove.options.role.name),
          recordingRole.subcommands.remove.options.role.description,
        ).setRequired(true),
      ),
    )
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingRole.subcommands.list.name),
        recordingRole.subcommands.list.description,
      ),
    );

  const recordingSummaryForumCommand = describe(
    new SlashCommandBuilder().setName(recordingSummaryForum.name),
    recordingSummaryForum.description,
  )
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingSummaryForum.subcommands.set.name),
        recordingSummaryForum.subcommands.set.description,
      )
        .addChannelOption((option) =>
          describe(
            option.setName(recordingSummaryForum.subcommands.set.options.forum.name),
            recordingSummaryForum.subcommands.set.options.forum.description,
          )
            .addChannelTypes(ChannelType.GuildForum)
            .setRequired(true),
        )
        .addStringOption((option) =>
          describe(
            option.setName(recordingSummaryForum.subcommands.set.options.tag.name),
            recordingSummaryForum.subcommands.set.options.tag.description,
          ).setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingSummaryForum.subcommands.show.name),
        recordingSummaryForum.subcommands.show.description,
      ),
    )
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingSummaryForum.subcommands.clear.name),
        recordingSummaryForum.subcommands.clear.description,
      ),
    );

  const recordingProfileCommand = describe(
    new SlashCommandBuilder().setName(recordingProfile.name),
    recordingProfile.description,
  )
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingProfile.subcommands.list.name),
        recordingProfile.subcommands.list.description,
      ),
    )
    .addSubcommand((subcommand) =>
      describe(
        subcommand.setName(recordingProfile.subcommands.set.name),
        recordingProfile.subcommands.set.description,
      ).addStringOption((option) =>
        describe(
          option.setName(recordingProfile.subcommands.set.options.profile.name),
          recordingProfile.subcommands.set.options.profile.description,
        ).setRequired(true),
      ),
    );

  const recordingActivateCommand = describe(
    new SlashCommandBuilder().setName(recordingActivate.name),
    recordingActivate.description,
  ).setDMPermission(false);

  return [
    recordCommand,
    stopCommand,
    recordingRoleCommand,
    recordingSummaryForumCommand,
    recordingProfileCommand,
    recordingActivateCommand,
  ] as const;
}
