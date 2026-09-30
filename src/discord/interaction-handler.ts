import {
  ChannelFlags,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  Events,
  type ForumChannel,
  type GuildMember,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import type { Logger } from "pino";

import { type AiProfileCompatibilityStatus, isAiProfileComplete } from "../ai-profile.js";
import { canConfigureSummaryForum, canManageRecordingRoles, canRecord } from "../authorization.js";
import type { AppConfig } from "../config.js";
import { CostReportError } from "../cost/cost-report.js";
import type { AiProfileStore } from "../database/postgres-ai-profile-store.js";
import type { GuildOwnerApprovalStore } from "../database/postgres-guild-owner-approval-store.js";
import type { GuildConfigurationStore } from "../guild-config-store.js";
import type { RecordingCoordinator } from "../recording/recording-coordinator.js";
import type { InstallationDiscordConnection } from "./installation-discord-connection.js";
import { evaluateGuildAccess } from "./installation-guild-policy.js";
import { getInteractionText, type InteractionText } from "./interaction-text.js";
import { handleRecordingStartError } from "./recording-start-error.js";
import { createEphemeralReply } from "./responses.js";

interface CommandDependencies {
  readonly aiProfileStore?: AiProfileStore;
  readonly coordinator: RecordingCoordinator;
  readonly costReport?: CostReportReader;
  readonly guildConfigStore: GuildConfigurationStore;
  readonly isOpenRouterConfigured: () => boolean | Promise<boolean>;
  readonly logger: Logger;
  readonly guildOwnerId: string | null;
  readonly ownerApprovals: GuildOwnerApprovalStore;
  readonly resolveAiProfileCompatibility?: (
    guildId: string,
  ) => Promise<readonly AiProfileCompatibilityStatus[]>;
}

const dispatchCommand = async (
  interaction: ChatInputCommandInteraction,
  dependencies: CommandDependencies,
  text: InteractionText,
): Promise<void> => {
  switch (interaction.commandName) {
    case "recording-role":
      return handleRecordingRole(
        interaction,
        dependencies.guildConfigStore,
        text,
        dependencies.guildOwnerId,
      );
    case "recording-summary-forum":
      return handleRecordingSummaryForum(
        interaction,
        dependencies.guildConfigStore,
        text,
        dependencies.guildOwnerId,
      );
    case "recording-cost":
      return handleRecordingCost(
        interaction,
        dependencies.coordinator,
        dependencies.costReport,
        text,
        dependencies.guildOwnerId,
      );
    case "recording-profile":
      return handleRecordingProfile(
        interaction,
        dependencies.aiProfileStore,
        text,
        dependencies.guildOwnerId,
      );
    case "recording-activate":
      return handleRecordingActivation(
        interaction,
        dependencies.guildConfigStore,
        dependencies.aiProfileStore,
        dependencies.ownerApprovals,
        text,
        dependencies.guildOwnerId,
      );
    case "record":
      return handleRecord(
        interaction,
        dependencies.guildConfigStore,
        dependencies.coordinator,
        text,
        dependencies.aiProfileStore,
        dependencies.resolveAiProfileCompatibility,
        dependencies.isOpenRouterConfigured,
        dependencies.logger,
        dependencies.guildOwnerId,
      );
    case "stop":
      return handleStop(
        interaction,
        dependencies.guildConfigStore,
        dependencies.coordinator,
        text,
        dependencies.guildOwnerId,
      );
  }
};

export function installInteractionHandler(
  client: Client,
  guildConfigStore: GuildConfigurationStore,
  coordinator: RecordingCoordinator,
  logger: Logger,
  language: AppConfig["botLanguage"],
  costReport: CostReportReader | undefined,
  aiProfileStore: AiProfileStore | undefined,
  resolveAiProfileCompatibility:
    | ((guildId: string) => Promise<readonly AiProfileCompatibilityStatus[]>)
    | undefined,
  isOpenRouterConfigured: () => boolean | Promise<boolean>,
  resolveBotLanguage: (guildId: string) => Promise<AppConfig["botLanguage"]>,
  connectedAccount: Pick<InstallationDiscordConnection, "getConnectedUserId">,
  ownerApprovals: GuildOwnerApprovalStore,
): void {
  client.on(Events.GuildMemberRemove, (member) => {
    void guildConfigStore
      .removeRecordingUser(member.guild.id, member.id)
      .catch((error: unknown) => {
        logger.error(
          { errorType: getErrorType(error), guildId: member.guild.id, userId: member.id },
          "Unable to revoke recording permission for departed guild member",
        );
      });
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    let text = getInteractionText(language);
    try {
      text = getInteractionText(
        interaction.guildId === null ? language : await resolveBotLanguage(interaction.guildId),
      );
      const guildAccess = await authorizeInteractionGuild(
        interaction,
        client,
        connectedAccount,
        ownerApprovals,
        text,
        logger,
      );
      if (!guildAccess.allowed) return;
      await dispatchCommand(
        interaction,
        {
          ...(aiProfileStore === undefined ? {} : { aiProfileStore }),
          coordinator,
          ...(costReport === undefined ? {} : { costReport }),
          guildConfigStore,
          isOpenRouterConfigured,
          logger,
          guildOwnerId: guildAccess.ownerId,
          ownerApprovals,
          ...(resolveAiProfileCompatibility === undefined ? {} : { resolveAiProfileCompatibility }),
        },
        text,
      );
    } catch (error) {
      logger.error(
        { commandName: interaction.commandName, errorType: getErrorType(error) },
        "Command execution failed",
      );
      await sendError(interaction, text.commandFailed);
    }
  });
}

async function authorizeInteractionGuild(
  interaction: ChatInputCommandInteraction,
  client: Client,
  connectedAccount: Pick<InstallationDiscordConnection, "getConnectedUserId">,
  ownerApprovals: GuildOwnerApprovalStore,
  text: InteractionText,
  logger: Pick<Logger, "warn">,
): Promise<{ allowed: boolean; ownerId: string | null }> {
  if (interaction.guildId === null || !isKnownCommand(interaction.commandName)) {
    return { allowed: true, ownerId: null };
  }
  let ownership: { connectedUserId: string; ownerId: string } | null;
  try {
    const connectedUserId = await connectedAccount.getConnectedUserId();
    const guild =
      connectedUserId === null
        ? null
        : await client.guilds.fetch({ guild: interaction.guildId, force: true });
    ownership =
      guild === null || connectedUserId === null
        ? null
        : { connectedUserId, ownerId: guild.ownerId };
  } catch (error) {
    logger.warn(
      { errorType: getErrorType(error), guildId: interaction.guildId },
      "Unable to verify guild ownership for command",
    );
    await interaction.reply(createEphemeralReply(text.ownershipCheckUnavailable));
    return { allowed: false, ownerId: null };
  }
  if (ownership === null) {
    await interaction.reply(createEphemeralReply(text.connectedAccountRequired));
    return { allowed: false, ownerId: null };
  }
  const access = evaluateGuildAccess({
    connectedUserId: ownership.connectedUserId,
    guildOwnerId: ownership.ownerId,
  });
  if (access !== "allowed") {
    await interaction.reply(createEphemeralReply(text.connectedOwnerRequired));
    return { allowed: false, ownerId: null };
  }
  let confirmed: boolean;
  try {
    confirmed = await ownerApprovals.isConfirmed(interaction.guildId, ownership.ownerId);
  } catch (error) {
    logger.warn(
      { errorType: getErrorType(error), guildId: interaction.guildId },
      "Unable to verify guild owner approval for command",
    );
    await interaction.reply(createEphemeralReply(text.ownershipCheckUnavailable));
    return { allowed: false, ownerId: null };
  }
  if (!confirmed && interaction.commandName === "record") {
    await interaction.reply(createEphemeralReply(text.ownerConfirmationRequired));
    return { allowed: false, ownerId: null };
  }
  return { allowed: true, ownerId: ownership.ownerId };
}

function isKnownCommand(name: string): boolean {
  return [
    "record",
    "stop",
    "recording-role",
    "recording-summary-forum",
    "recording-cost",
    "recording-profile",
    "recording-activate",
  ].includes(name);
}

async function handleRecordingProfile(
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

async function handleRecordingActivation(
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

const validateActiveAiProfile = async (
  interaction: ChatInputCommandInteraction,
  guildId: string,
  store: AiProfileStore,
  isOpenRouterConfigured: () => boolean | Promise<boolean>,
  text: InteractionText,
): Promise<boolean> => {
  const profile = await store.getActiveProfile(guildId);
  if (profile === undefined || !isAiProfileComplete(profile)) {
    await interaction.reply(createEphemeralReply(text.configureAiProfileFirst));
    return false;
  }
  const usesOpenRouter = [profile.transcription, profile.refinement, profile.summary].some(
    (phase) => phase.provider === "openrouter",
  );
  if (usesOpenRouter && !(await isOpenRouterConfigured())) {
    await interaction.reply(createEphemeralReply(text.openRouterApiKeyMissing));
    return false;
  }
  return true;
};

export interface CostReportReader {
  meeting(guildId: string, meetingId: string): Promise<string>;
  period(guildId: string, from: string, to: string): Promise<string>;
}

async function handleRecordingCost(
  interaction: ChatInputCommandInteraction,
  coordinator: RecordingCoordinator,
  report: CostReportReader | undefined,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) return;
  if (!context.isGuildOwner) {
    await interaction.reply(createEphemeralReply(text.cannotViewCosts));
    return;
  }
  if (report === undefined) throw new Error("The cost report service is unavailable");
  const subcommand = interaction.options.getSubcommand(true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (subcommand === "meeting") {
      const meetingId = interaction.options.getString("id", true);
      if (coordinator.get(context.guildId)?.meetingId === meetingId) {
        await interaction.editReply(text.costMeetingInProgress);
        return;
      }
      await interaction.editReply(await report.meeting(context.guildId, meetingId));
      return;
    }
    const from = interaction.options.getString("from", true);
    const to = interaction.options.getString("to", true);
    await interaction.editReply(await report.period(context.guildId, from, to));
  } catch (error) {
    const message = costReportErrorMessage(error, text);
    if (message !== undefined) return void (await interaction.editReply(message));
    throw error;
  }
}

function costReportErrorMessage(error: unknown, text: InteractionText): string | undefined {
  if (!(error instanceof CostReportError)) return undefined;
  if (error.code === "meeting_in_progress") return text.costMeetingInProgress;
  if (error.code === "invalid_period") return text.costInvalidPeriod;
  return text.costMeetingNotFound;
}

async function handleRecordingSummaryForum(
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

async function handleRecordingRole(
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

async function handleRecord(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  coordinator: RecordingCoordinator,
  text: InteractionText,
  aiProfileStore: AiProfileStore | undefined,
  resolveAiProfileCompatibility:
    | ((guildId: string) => Promise<readonly AiProfileCompatibilityStatus[]>)
    | undefined,
  isOpenRouterConfigured: () => boolean | Promise<boolean>,
  logger: Logger,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) {
    return;
  }
  if (
    !(await isRecordingAuthorized(context.member, context.isGuildOwner, context.guildId, store))
  ) {
    await interaction.reply(createEphemeralReply(text.cannotRecord));
    return;
  }
  if ((await store.getSummaryForum(context.guildId)) === undefined) {
    await interaction.reply(createEphemeralReply(text.configureForumFirst));
    return;
  }
  if (aiProfileStore !== undefined) {
    const valid = await validateActiveAiProfile(
      interaction,
      context.guildId,
      aiProfileStore,
      isOpenRouterConfigured,
      text,
    );
    if (!valid) return;
  }
  const compatibility = (await resolveAiProfileCompatibility?.(context.guildId)) ?? [];
  if (compatibility.includes("incompatible")) {
    await interaction.reply(createEphemeralReply(text.incompatibleAiProfile));
    return;
  }
  const voiceChannel = context.member.voice.channel;
  if (voiceChannel?.type !== ChannelType.GuildVoice) {
    await interaction.reply(createEphemeralReply(text.joinVoiceFirst));
    return;
  }

  await interaction.deferReply();
  try {
    const handle = await coordinator.start({
      guildId: context.guildId,
      guildIconUrl: context.member.guild.iconURL({ extension: "png", size: 128 }),
      guildName: context.member.guild.name,
      notificationChannelId: interaction.channelId,
      startedByUserId: interaction.user.id,
      ...verifiedOwnerInput(guildOwnerId),
      voiceChannelId: voiceChannel.id,
      voiceChannelName: voiceChannel.name,
    });
    await interaction.editReply(
      text.recordingStarted(voiceChannel.name, String(interaction.user), handle.meetingId),
    );
    if (compatibility.includes("above_recommended")) {
      await interaction.followUp(createEphemeralReply(text.aboveRecommendedAiProfile));
    }
    if (compatibility.includes("unknown")) {
      await interaction.followUp(createEphemeralReply(text.unknownAiProfileCompatibility));
    }
  } catch (error) {
    if (await handleRecordingStartError(error, interaction, text, logger)) return;
    throw error;
  }
}

function verifiedOwnerInput(ownerId: string | null): { verifiedOwnerUserId?: string } {
  return ownerId === null ? {} : { verifiedOwnerUserId: ownerId };
}

async function handleStop(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  coordinator: RecordingCoordinator,
  text: InteractionText,
  guildOwnerId: string | null,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text, guildOwnerId);
  if (context === undefined) {
    return;
  }
  const activeRecording = coordinator.get(context.guildId);
  if (activeRecording === undefined) {
    await interaction.reply(createEphemeralReply(text.noActiveRecording));
    return;
  }
  if (context.member.voice.channelId !== activeRecording.voiceChannelId) {
    await interaction.reply(createEphemeralReply(text.userMustBeInRecordedChannel));
    return;
  }
  if (
    !(await isRecordingAuthorized(context.member, context.isGuildOwner, context.guildId, store))
  ) {
    await interaction.reply(createEphemeralReply(text.cannotStop));
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await coordinator.stop(context.guildId, {
    reason: "command",
    stoppedByUserId: interaction.user.id,
  });
  await interaction.editReply(text.stopProcessed(activeRecording.notificationChannelId));
}

async function resolveGuildContext(
  interaction: ChatInputCommandInteraction,
  text: InteractionText,
  guildOwnerId: string | null,
) {
  if (interaction.guild === null || interaction.guildId === null || guildOwnerId === null) {
    await interaction.reply(createEphemeralReply(text.guildOnly));
    return undefined;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return {
    guildId: interaction.guildId,
    isGuildOwner: guildOwnerId === interaction.user.id,
    member,
  };
}

async function isRecordingAuthorized(
  member: GuildMember,
  isGuildOwner: boolean,
  guildId: string,
  store: GuildConfigurationStore,
): Promise<boolean> {
  const permissions = await store.getRecordingPermissions(guildId);
  return canRecord({
    isGuildOwner,
    memberJoinedAt: member.joinedAt?.toISOString() ?? null,
    memberRoleIds: [...member.roles.cache.keys()],
    memberUserId: member.id,
    recordingRoleIds: permissions.roleIds,
    recordingUserGrants: permissions.userGrants,
  });
}

async function sendError(interaction: ChatInputCommandInteraction, message: string): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(message).catch(() => undefined);
  } else {
    await interaction.reply(createEphemeralReply(message)).catch(() => undefined);
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
