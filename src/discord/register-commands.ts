import { REST, Routes } from "discord.js";

import type { AppConfig } from "../config.js";
import { commandDefinitions } from "./commands.js";

export async function registerCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const route =
    config.discordGuildId === undefined
      ? Routes.applicationCommands(config.discordClientId)
      : Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId);

  await rest.put(route, { body: commandDefinitions.map((command) => command.toJSON()) });
}
