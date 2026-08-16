import { ChannelType, Events, type Client } from "discord.js";
import type { Logger } from "pino";

import type { RecordingCoordinator } from "../recording/recording-coordinator.js";

export function installVoiceStateHandler(
  client: Client,
  coordinator: RecordingCoordinator,
  logger: Logger,
): void {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const guildId = newState.guild.id;
    const activeRecording = coordinator.get(guildId);
    if (activeRecording === undefined) {
      return;
    }
    if (
      oldState.channelId !== activeRecording.voiceChannelId &&
      newState.channelId !== activeRecording.voiceChannelId
    ) {
      return;
    }

    const channel = newState.guild.channels.cache.get(activeRecording.voiceChannelId);
    if (channel?.type !== ChannelType.GuildVoice) {
      return;
    }
    const humanCount = channel.members.filter((member) => !member.user.bot).size;

    try {
      await coordinator.handleHumanCountChanged(guildId, channel.id, humanCount);
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : typeof error, guildId },
        "Falha ao reagir à mudança no canal de voz",
      );
    }
  });
}
