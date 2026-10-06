import { REST, Routes } from "discord.js";

import type { AppConfig } from "../config.js";
import { createCommandDefinitions } from "./commands.js";

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commandDefinitions = createCommandDefinitions();
  const route = Routes.applicationCommands(config.discordApplicationId);

  await rest.put(route, { body: commandDefinitions.map((command) => command.toJSON()) });
}
