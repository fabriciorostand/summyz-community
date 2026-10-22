import type { VoiceChannel } from "discord.js";

export function countHumans(channel: VoiceChannel): number {
  return channel.members.filter((member) => !member.user.bot).size;
}

export function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
