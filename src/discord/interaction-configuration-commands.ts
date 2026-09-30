import {
  ChannelFlags,
  ChannelType,
  type ChatInputCommandInteraction,
  type ForumChannel,
  type GuildMember,
  PermissionFlagsBits,
} from "discord.js";

import { isAiProfileComplete } from "../ai-profile.js";
import { canConfigureSummaryForum, canManageRecordingRoles } from "../authorization.js";
import type { AiProfileStore } from "../database/postgres-ai-profile-store.js";
import type { GuildOwnerApprovalStore } from "../database/postgres-guild-owner-approval-store.js";
import type { GuildConfigurationStore } from "../guild-config-store.js";
import { resolveGuildContext } from "./interaction-context.js";
import type { InteractionText } from "./interaction-text.js";
import { createEphemeralReply } from "./responses.js";

export async function handleRecordingProfile(
  interaction: ChatInputCommandInteraction,
  store: AiProfileStore | undefined,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) return;
  if (!context.isGuildOwner) {
    await interaction.reply(createEphemeralReply(text.cannotConfigureSummaryForum));
    return;
  }
  if (store === undefined) throw new Error("AI profile store is unavailable");
  const profiles = (await store.listProfiles()).filter(isAiProfileComplete);
  if (interaction.options.getSubcommand(true) === "list") {
    await interaction.reply(
      createEphemeralReply(
        text.profileList(profiles.map((profile) => `${profile.name}: ${profile.profileId}`)),
      ),
    );
    return;
  }
  const profileId = interaction.options.getString("profile", true);
  const profile = profiles.find((item) => item.profileId === profileId);
  if (profile === undefined) {
    await interaction.reply(createEphemeralReply(text.profileNotFound));
    return;
  }
  await store.setActiveProfile(context.guildId, profile.profileId);
  await interaction.reply(createEphemeralReply(text.profileSelected(profile.name)));
}

export async function handleRecordingActivation(
  interaction: ChatInputCommandInteraction,
  guildConfig: GuildConfigurationStore,
  aiProfiles: AiProfileStore | undefined,
  approvals: GuildOwnerApprovalStore,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) return;
  if (!context.isGuildOwner) {
    await interaction.reply(createEphemeralReply(text.cannotConfigureSummaryForum));
    return;
  }
  const [forum, profile] = await Promise.all([
    guildConfig.getSummaryForum(context.guildId),
    aiProfiles?.getActiveProfile(context.guildId),
  ]);
  if (forum === undefined) {
    await interaction.reply(createEphemeralReply(text.configureForumFirst));
    return;
  }
  if (profile === undefined || !isAiProfileComplete(profile)) {
    await interaction.reply(createEphemeralReply(text.configureAiProfileFirst));
    return;
  }
  if (guildOwnerId === null || !(await approvals.confirm(context.guildId, guildOwnerId))) {
    await interaction.reply(createEphemeralReply(text.ownerConfirmationRequired));
    return;
  }
  await interaction.reply(createEphemeralReply(text.ownerConfirmationCompleted));
}

export async function handleRecordingSummaryForum(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) {
    return;
  }
  if (
    !canConfigureSummaryForum({
      isGuildOwner: context.isGuildOwner,
    })
  ) {
    await interaction.reply(createEphemeralReply(text.cannotConfigureSummaryForum));
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "show") {
    return showSummaryForum(interaction, store, context.guildId, text);
  }
  if (subcommand === "clear") {
    return clearSummaryForum(interaction, store, context.guildId, text);
  }
  await configureSummaryForum(interaction, store, context.guildId, text);
}

async function showSummaryForum(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  guildId: string,
  text: InteractionText,
): Promise<void> {
  const configured = await store.getSummaryForum(guildId);
  const content =
    configured === undefined
      ? text.noSummaryForum
      : text.forumDisplay(configured.forumId, configured.tagId);
  await interaction.reply(createEphemeralReply(content));
}

async function clearSummaryForum(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  guildId: string,
  text: InteractionText,
): Promise<void> {
  await store.clearSummaryForum(guildId);
  await interaction.reply(createEphemeralReply(text.summaryForumCleared));
}

async function configureSummaryForum(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  guildId: string,
  text: InteractionText,
): Promise<void> {
  const selectedChannel = interaction.options.getChannel("forum", true, [ChannelType.GuildForum]);
  if (selectedChannel.type !== ChannelType.GuildForum) {
    await interaction.reply(createEphemeralReply(text.invalidForum));
    return;
  }
  const forum: ForumChannel = selectedChannel;
  const botMember = await interaction.guild?.members.fetchMe();
  if (botMember === undefined) {
    throw new Error("Não foi possível identificar o usuário do bot no servidor");
  }
  if (!hasSummaryForumPermissions(forum, botMember)) {
    await interaction.reply(createEphemeralReply(text.insufficientForumPermissions));
    return;
  }

  const tagInput = interaction.options.getString("tag") ?? undefined;
  const tag = findForumTag(forum, tagInput, text.locale);
  if (tagInput !== undefined && tag === undefined) {
    await interaction.reply(createEphemeralReply(text.tagNotFound));
    return;
  }
  if (forum.flags.has(ChannelFlags.RequireTag) && tag === undefined) {
    await interaction.reply(createEphemeralReply(text.forumRequiresTag));
    return;
  }

  await store.setSummaryForum(guildId, {
    forumId: forum.id,
    ...(tag === undefined ? {} : { tagId: tag.id }),
  });
  await interaction.reply(createEphemeralReply(text.forumConfigured(forum.id, tag?.name)));
}

function hasSummaryForumPermissions(forum: ForumChannel, botMember: GuildMember): boolean {
  return (
    forum
      .permissionsFor(botMember)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
      ]) === true
  );
}

function findForumTag(
  forum: ForumChannel,
  input: string | undefined,
  locale: string,
): ForumChannel["availableTags"][number] | undefined {
  if (input === undefined) return undefined;
  return forum.availableTags.find(
    (candidate) =>
      candidate.id === input ||
      candidate.name.localeCompare(input, locale, { sensitivity: "accent" }) === 0,
  );
}

export async function handleRecordingRole(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) {
    return;
  }
  if (
    !canManageRecordingRoles({
      isGuildOwner: context.isGuildOwner,
    })
  ) {
    await interaction.reply(createEphemeralReply(text.cannotConfigureRecordingRoles));
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);
  if (subcommand === "list") {
    const roleIds = (await store.getRecordingPermissions(context.guildId)).roleIds;
    const content = roleIds.length === 0 ? text.noAuthorizedRoles : text.authorizedRoles(roleIds);
    await interaction.reply(createEphemeralReply(content));
    return;
  }

  const role = interaction.options.getRole("role", true);
  const permissions = await store.getRecordingPermissions(context.guildId);
  if (subcommand === "add") {
    await store.setRecordingPermissions(context.guildId, {
      ...permissions,
      roleIds: [...new Set([...permissions.roleIds, role.id])],
    });
    await interaction.reply(createEphemeralReply(text.roleAuthorized(String(role))));
    return;
  }

  await store.setRecordingPermissions(context.guildId, {
    ...permissions,
    roleIds: permissions.roleIds.filter((roleId) => roleId !== role.id),
  });
  await interaction.reply(createEphemeralReply(text.roleRemoved(String(role))));
}
