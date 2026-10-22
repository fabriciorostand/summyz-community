import { ChannelType, type Client, Events, type VoiceState } from "discord.js";
import type { Logger } from "pino";

import type { RecordingCoordinator } from "../recording/recording-coordinator.js";

export function installVoiceStateHandler(
  client: Client,
  coordinator: RecordingCoordinator,
  logger: Logger,
): void {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      await handleVoiceStateUpdate(oldState, newState, coordinator);
    } catch (error) {
      logger.error(
        {
          errorType: error instanceof Error ? error.name : typeof error,
          guildId: newState.guild.id,
        },
        "Failed to handle voice channel state change",
      );
    }
  });
}

async function handleVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
  coordinator: RecordingCoordinator,
): Promise<void> {
  const guildId = newState.guild.id;
  const activeRecording = coordinator.get(guildId);
  if (
    activeRecording === undefined ||
    !touchesChannel(oldState, newState, activeRecording.voiceChannelId)
  )
    return;
  const channel = newState.guild.channels.cache.get(activeRecording.voiceChannelId);
  if (channel?.type !== ChannelType.GuildVoice) return;
  if (isNewHumanParticipant(oldState, newState, activeRecording.voiceChannelId)) {
    await coordinator.recordParticipant(
      guildId,
      channel.id,
      newState.member.id,
      newState.member.displayName,
      newState.member.displayAvatarURL({ extension: "png", size: 128 }),
    );
  }
  await coordinator.updateLiveParticipants(
    guildId,
    channel.id,
    channel.members
      .filter((member) => !member.user.bot)
      .map((member) => ({
        avatarUrl: member.displayAvatarURL({ extension: "png", size: 128 }),
        displayName: member.displayName,
        userId: member.id,
      })),
  );
  const humanCount = channel.members.filter((member) => !member.user.bot).size;
  await coordinator.handleHumanCountChanged(guildId, channel.id, humanCount);
}

function touchesChannel(oldState: VoiceState, newState: VoiceState, channelId: string): boolean {
  return oldState.channelId === channelId || newState.channelId === channelId;
}

function isNewHumanParticipant(
  oldState: VoiceState,
  newState: VoiceState,
  channelId: string,
): newState is VoiceState & { member: NonNullable<VoiceState["member"]> } {
  return (
    newState.channelId === channelId &&
    oldState.channelId !== channelId &&
    newState.member !== null &&
    !newState.member.user.bot
  );
}
