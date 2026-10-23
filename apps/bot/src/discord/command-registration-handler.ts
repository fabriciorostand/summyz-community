import { Events } from "discord.js";
import type { AppConfig } from "../config.js";
import {
  type CommandRegistrationLogger,
  commandRegistrationErrorContext,
  discordCommandIdSchema,
  registerCommands,
  removeGuildSlashCommands,
} from "./register-commands.js";

interface CommandRegistrationEvents {
  once(
    event: Events.ClientReady,
    listener: (client: { guilds: { cache: ReadonlyMap<string, unknown> } }) => Promise<void>,
  ): void;
  on(event: Events.GuildCreate, listener: (guild: { id: string }) => Promise<void>): void;
}

export function installCommandRegistrationHandler(
  client: CommandRegistrationEvents,
  config: AppConfig,
  logger: CommandRegistrationLogger,
): void {
  let globalRegistration: Promise<boolean> | undefined;

  const reconcileGuild = async (guildId: string): Promise<void> => {
    const validated = discordCommandIdSchema.safeParse(guildId);
    if (!validated.success) {
      logger.error({ errorType: "InvalidGuildId" }, "Unable to reconcile guild slash commands");
      return;
    }
    try {
      await removeGuildSlashCommands(config, validated.data, logger);
    } catch (error: unknown) {
      logger.error(
        { guildId: validated.data, ...commandRegistrationErrorContext(error) },
        "Unable to reconcile guild slash commands",
      );
    }
  };

  client.once(Events.ClientReady, async (readyClient) => {
    globalRegistration = registerCommands(config, logger)
      .then(() => {
        logger.info({ registrationScope: "global" }, "Commands registered");
        return true;
      })
      .catch((error: unknown) => {
        logger.error(commandRegistrationErrorContext(error), "Command registration failed");
        return false;
      });
    if (!(await globalRegistration)) return;
    for (const guildId of readyClient.guilds.cache.keys()) {
      await reconcileGuild(guildId);
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    // Initial guild events are covered by the ready client's guild cache.
    if (globalRegistration === undefined || !(await globalRegistration)) return;
    await reconcileGuild(guild.id);
  });
}
