import { type Client, Events } from "discord.js";
import type { Logger } from "pino";
import type { GuildOwnerApprovalStore } from "../database/postgres-guild-owner-approval-store.js";
import type { RecordingCoordinator } from "../recording/recording-coordinator.js";

export type GuildAccessResult =
  | { status: "allowed"; connectedUserId: string }
  | {
      status: "denied";
      connectedUserId?: string;
      reason?: "different_owner" | "approval_missing";
    }
  | { status: "unknown"; connectedUserId?: string };

export function installGuildOwnershipHandler(
  client: Client,
  coordinator: RecordingCoordinator,
  approvals: GuildOwnerApprovalStore,
  logger: Pick<Logger, "error" | "info">,
): void {
  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await approvals.isConfirmed(guild.id, guild.ownerId);
      } catch (error) {
        logger.error(
          { errorType: error instanceof Error ? error.name : typeof error, guildId: guild.id },
          "Unable to record initial guild ownership",
        );
      }
    }
  });
  client.on(Events.GuildUpdate, async (before, after) => {
    if (before.ownerId === after.ownerId) return;
    try {
      if (coordinator.get(after.id) !== undefined) {
        await coordinator.stop(after.id, { reason: "owner_changed" });
      }
      await approvals.isConfirmed(after.id, after.ownerId);
      logger.info({ guildId: after.id }, "Guild ownership changed; recording access suspended");
    } catch (error) {
      logger.error(
        { errorType: error instanceof Error ? error.name : typeof error, guildId: after.id },
        "Unable to handle guild ownership change",
      );
    }
  });
}
