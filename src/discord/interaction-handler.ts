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

import { isAiProfileComplete, type AiProfileCompatibilityStatus } from "../ai-profile.js";
import { canConfigureSummaryForum, canManageRecordingRoles, canRecord } from "../authorization.js";
import type { AppConfig } from "../config.js";
import { CostReportError } from "../cost/cost-report.js";
import type { GuildConfigurationStore } from "../guild-config-store.js";
import type { AiProfileStore } from "../database/postgres-ai-profile-store.js";
import {
  RecordingAlreadyActiveError,
  type RecordingCoordinator,
} from "../recording/recording-coordinator.js";
import { createEphemeralReply } from "./responses.js";
import { getInteractionText, type InteractionText } from "./interaction-text.js";

export function installInteractionHandler(
  client: Client,
  guildConfigStore: GuildConfigurationStore,
  coordinator: RecordingCoordinator,
  logger: Logger,
  language: AppConfig["botLanguage"],
  costReport?: CostReportReader,
  aiProfileStore?: AiProfileStore,
  resolveAiProfileCompatibility?: (
    guildId: string,
  ) => Promise<readonly AiProfileCompatibilityStatus[]>,
  isOpenRouterConfigured: () => boolean = () => false,
): void {
  const text = getInteractionText(language);
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      if (interaction.commandName === "recording-role") {
        await handleRecordingRole(interaction, guildConfigStore, text);
      } else if (interaction.commandName === "recording-summary-forum") {
        await handleRecordingSummaryForum(interaction, guildConfigStore, text);
      } else if (interaction.commandName === "recording-cost") {
        await handleRecordingCost(interaction, coordinator, costReport, text);
      } else if (interaction.commandName === "record") {
        await handleRecord(
          interaction,
          guildConfigStore,
          coordinator,
          text,
          aiProfileStore,
          resolveAiProfileCompatibility,
          isOpenRouterConfigured,
        );
      } else if (interaction.commandName === "stop") {
        await handleStop(interaction, guildConfigStore, coordinator, text);
      }
    } catch (error) {
      logger.error(
        { commandName: interaction.commandName, errorType: getErrorType(error) },
        "Command execution failed",
      );
      await sendError(interaction, text.commandFailed);
    }
  });
}

export interface CostReportReader {
  meeting(guildId: string, meetingId: string): Promise<string>;
  period(guildId: string, from: string, to: string): Promise<string>;
}

async function handleRecordingCost(
  interaction: ChatInputCommandInteraction,
  coordinator: RecordingCoordinator,
  report: CostReportReader | undefined,
  text: InteractionText,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text);
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
    if (error instanceof CostReportError) {
      const message =
        error.code === "meeting_in_progress"
          ? text.costMeetingInProgress
          : error.code === "invalid_period"
            ? text.costInvalidPeriod
            : text.costMeetingNotFound;
      await interaction.editReply(message);
      return;
    }
    throw error;
  }
}

async function handleRecordingSummaryForum(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  text: InteractionText,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text);
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
    const configured = await store.getSummaryForum(context.guildId);
    const content =
      configured === undefined
        ? text.noSummaryForum
        : text.forumDisplay(configured.forumId, configured.tagId);
    await interaction.reply(createEphemeralReply(content));
    return;
  }

  if (subcommand === "clear") {
    await store.clearSummaryForum(context.guildId);
    await interaction.reply(createEphemeralReply(text.summaryForumCleared));
    return;
  }

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
  const permissions = forum.permissionsFor(botMember);
  if (
    !permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
    ])
  ) {
    await interaction.reply(createEphemeralReply(text.insufficientForumPermissions));
    return;
  }

  const tagInput = interaction.options.getString("tag") ?? undefined;
  const tag =
    tagInput === undefined
      ? undefined
      : forum.availableTags.find(
          (candidate) =>
            candidate.id === tagInput ||
            candidate.name.localeCompare(tagInput, text.locale, { sensitivity: "accent" }) === 0,
        );
  if (tagInput !== undefined && tag === undefined) {
    await interaction.reply(createEphemeralReply(text.tagNotFound));
    return;
  }
  if (forum.flags.has(ChannelFlags.RequireTag) && tag === undefined) {
    await interaction.reply(createEphemeralReply(text.forumRequiresTag));
    return;
  }

  await store.setSummaryForum(context.guildId, {
    forumId: forum.id,
    ...(tag === undefined ? {} : { tagId: tag.id }),
  });
  await interaction.reply(createEphemeralReply(text.forumConfigured(forum.id, tag?.name)));
}

async function handleRecordingRole(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  text: InteractionText,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text);
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
    const roleIds = await store.listRecordingRoles(context.guildId);
    const content = roleIds.length === 0 ? text.noAuthorizedRoles : text.authorizedRoles(roleIds);
    await interaction.reply(createEphemeralReply(content));
    return;
  }

  const role = interaction.options.getRole("role", true);
  if (subcommand === "add") {
    await store.addRecordingRole(context.guildId, role.id);
    await interaction.reply(createEphemeralReply(text.roleAuthorized(String(role))));
    return;
  }

  await store.removeRecordingRole(context.guildId, role.id);
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
  isOpenRouterConfigured: () => boolean,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text);
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
    await aiProfileStore.ensureInitialProfile(context.guildId);
    const profile = await aiProfileStore.getActiveProfile(context.guildId);
    if (!isAiProfileComplete(profile)) {
      await interaction.reply(createEphemeralReply(text.configureAiProfileFirst));
      return;
    }
    if (
      [profile.transcription, profile.refinement, profile.summary].some(
        (phase) => phase.provider === "openrouter",
      ) &&
      !isOpenRouterConfigured()
    ) {
      await interaction.reply(createEphemeralReply(text.openRouterApiKeyMissing));
      return;
    }
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
      notificationChannelId: interaction.channelId,
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
    if (error instanceof RecordingAlreadyActiveError) {
      await interaction.editReply(text.recordingAlreadyActive);
      return;
    }
    throw error;
  }
}

async function handleStop(
  interaction: ChatInputCommandInteraction,
  store: GuildConfigurationStore,
  coordinator: RecordingCoordinator,
  text: InteractionText,
): Promise<void> {
  const context = await resolveGuildContext(interaction, text);
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
) {
  if (interaction.guild === null || interaction.guildId === null) {
    await interaction.reply(createEphemeralReply(text.guildOnly));
    return undefined;
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return {
    guildId: interaction.guildId,
    isGuildOwner: interaction.guild.ownerId === interaction.user.id,
    member,
  };
}

async function isRecordingAuthorized(
  member: GuildMember,
  isGuildOwner: boolean,
  guildId: string,
  store: GuildConfigurationStore,
): Promise<boolean> {
  return canRecord({
    isGuildOwner,
    memberRoleIds: [...member.roles.cache.keys()],
    recordingRoleIds: await store.listRecordingRoles(guildId),
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
