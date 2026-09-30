import type { ChatInputCommandInteraction, Client } from "discord.js";
import type { Logger } from "pino";

import type { GuildOwnerApprovalStore } from "../database/postgres-guild-owner-approval-store.js";
import type { InstallationDiscordConnection } from "./installation-discord-connection.js";
import { evaluateGuildAccess } from "./installation-guild-policy.js";
import type { InteractionText } from "./interaction-text.js";
import { createEphemeralReply } from "./responses.js";

interface GuildOwnership {
  readonly connectedUserId: string;
  readonly ownerId: string;
}

async function readGuildOwnership(
  client: Client,
  connectedAccount: Pick<InstallationDiscordConnection, "getConnectedUserId">,
  guildId: string,
): Promise<GuildOwnership | null> {
  const connectedUserId = await connectedAccount.getConnectedUserId();
  if (connectedUserId === null) return null;
  const guild = await client.guilds.fetch({ guild: guildId, force: true });
  return { connectedUserId, ownerId: guild.ownerId };
}

export async function authorizeInteractionGuild(
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
  let ownership: GuildOwnership | null;
  try {
    ownership = await readGuildOwnership(client, connectedAccount, interaction.guildId);
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

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
