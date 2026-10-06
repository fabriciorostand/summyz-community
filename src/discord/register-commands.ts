import {
  ApplicationCommandType,
  DiscordAPIError,
  REST,
  RESTJSONErrorCodes,
  Routes,
} from "discord.js";
import type { Logger } from "pino";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import { createCommandDefinitions } from "./commands.js";

export type CommandRegistrationLogger = Pick<Logger, "error" | "info">;

export const discordCommandIdSchema = z.string().regex(/^\d{17,20}$/u);

const registeredCommandsSchema = z.array(
  z.object({
    application_id: discordCommandIdSchema,
    guild_id: discordCommandIdSchema.optional(),
    id: discordCommandIdSchema,
    name: z.string().min(1).max(32),
    type: z.number().int().min(1).max(4),
  }),
);

type RegisteredCommand = z.infer<typeof registeredCommandsSchema>[number];

export function commandRegistrationErrorContext(error: unknown) {
  // Error messages, names and request bodies may contain credentials.
  return error instanceof DiscordAPIError
    ? {
        discordCode: typeof error.code === "number" ? error.code : undefined,
        discordStatus: error.status,
        errorType: "DiscordAPIError",
      }
    : { errorType: error instanceof Error ? "Error" : typeof error };
}

async function readCommands(
  rest: REST,
  applicationId: string,
  guildId?: string,
): Promise<RegisteredCommand[]> {
  const route =
    guildId === undefined
      ? Routes.applicationCommands(applicationId)
      : Routes.applicationGuildCommands(applicationId, guildId);
  const payload: unknown = await rest.get(route);
  const commands = registeredCommandsSchema.parse(payload);
  if (
    commands.some(
      (command) => command.application_id !== applicationId || command.guild_id !== guildId,
    )
  ) {
    throw new Error("Discord command scope mismatch");
  }
  return commands;
}

async function removeCommands(
  rest: REST,
  commands: readonly RegisteredCommand[],
  applicationId: string,
  logger: CommandRegistrationLogger,
  guildId?: string,
): Promise<void> {
  let removedCount = 0;
  let failedCount = 0;
  const context = {
    applicationId,
    guildId,
    registrationScope: guildId === undefined ? "global" : "guild",
  };
  for (const command of commands) {
    const route =
      guildId === undefined
        ? Routes.applicationCommand(applicationId, command.id)
        : Routes.applicationGuildCommand(applicationId, guildId, command.id);
    try {
      await rest.delete(route);
      removedCount += 1;
      logger.info({ ...context, commandId: command.id }, "Obsolete slash command removed");
    } catch (error: unknown) {
      if (
        error instanceof DiscordAPIError &&
        error.code === RESTJSONErrorCodes.UnknownApplicationCommand
      )
        continue;
      failedCount += 1;
      logger.error(
        { ...context, commandId: command.id, ...commandRegistrationErrorContext(error) },
        "Unable to remove obsolete slash command",
      );
    }
  }
  logger.info({ ...context, failedCount, removedCount }, "Slash command cleanup completed");
}

export async function registerCommands(
  config: AppConfig,
  logger: CommandRegistrationLogger,
): Promise<void> {
  const applicationId = discordCommandIdSchema.parse(config.discordApplicationId);
  const rest = new REST({ version: "10", hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(
    config.discordToken,
  );
  const definitions = createCommandDefinitions().map((command) => command.toJSON());
  const commands = await readCommands(rest, applicationId);
  const currentNames = new Set(definitions.map((command) => command.name));

  // Publish the entire current catalog before removing any existing commands.
  // Individual upserts preserve non-slash commands and existing command IDs.
  for (const definition of definitions) {
    await rest.post(Routes.applicationCommands(applicationId), { body: definition });
  }

  await removeCommands(
    rest,
    commands.filter(
      (command) =>
        command.type === ApplicationCommandType.ChatInput && !currentNames.has(command.name),
    ),
    applicationId,
    logger,
  );
}

export async function removeGuildSlashCommands(
  config: AppConfig,
  guildId: string,
  logger: CommandRegistrationLogger,
): Promise<void> {
  const applicationId = discordCommandIdSchema.parse(config.discordApplicationId);
  const validatedGuildId = discordCommandIdSchema.parse(guildId);
  const rest = new REST({ version: "10", hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(
    config.discordToken,
  );
  const commands = await readCommands(rest, applicationId, validatedGuildId);
  await removeCommands(
    rest,
    commands.filter((command) => command.type === ApplicationCommandType.ChatInput),
    applicationId,
    logger,
    validatedGuildId,
  );
}
