import type { ChatInputCommandInteraction } from "discord.js";

import type { InteractionText } from "./interaction-text.js";
import { createEphemeralReply } from "./responses.js";

export async function resolveGuildContext(
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
