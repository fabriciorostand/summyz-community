import { MessageFlags, type InteractionReplyOptions } from "discord.js";

export function createEphemeralReply(content: string): InteractionReplyOptions {
  return {
    content,
    flags: MessageFlags.Ephemeral,
  };
}
