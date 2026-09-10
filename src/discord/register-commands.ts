import { REST, Routes } from "discord.js";

import type { AppConfig } from "../config.js";
import { createCommandDefinitions } from "./commands.js";

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commandDefinitions = createCommandDefinitions(config.botLanguage);
  const route =
    config.discordGuildId === undefined
      ? Routes.applicationCommands(config.discordApplicationId)
      : Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId);

  await rest.put(route, { body: commandDefinitions.map((command) => command.toJSON()) });
}
