import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { join } from "node:path";

import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
import { installInteractionHandler } from "./discord/interaction-handler.js";
import { registerCommands } from "./discord/register-commands.js";
import { installVoiceStateHandler } from "./discord/voice-state-handler.js";
import { GuildConfigStore } from "./guild-config-store.js";
import { createLogger } from "./logger.js";
import { DiscordRecordingFactory } from "./recording/discord-recording-factory.js";
import { ManifestStore } from "./recording/manifest-store.js";
import { RecordingCoordinator } from "./recording/recording-coordinator.js";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

let config: ReturnType<typeof loadConfig>;
try {
  config = loadConfig(process.env);
} catch {
  console.error(
    "Configuração inválida. Revise o arquivo .env usando .env.example como referência.",
  );
  process.exitCode = 1;
  throw new Error("Configuração inválida");
}

const logger = createLogger(config.logLevel);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const guildConfigStore = new GuildConfigStore(join(config.dataDir, "config", "guilds.json"));
const manifestStore = new ManifestStore(join(config.dataDir, "recordings"));
const recordingFactory = new DiscordRecordingFactory(client, config, manifestStore, logger);
const coordinator = new RecordingCoordinator(recordingFactory);

installInteractionHandler(client, guildConfigStore, coordinator, logger);
installVoiceStateHandler(client, coordinator, logger);

client.once(Events.ClientReady, async (readyClient) => {
  logger.info({ botUserId: readyClient.user.id }, "Summyz conectado ao Discord");
  try {
    await registerCommands(config);
    logger.info(
      { registrationScope: config.discordGuildId === undefined ? "global" : "guild" },
      "Comandos registrados",
    );
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Falha ao registrar comandos",
    );
  }

  try {
    const recoverableManifests = await manifestStore.listRecoverable();
    for (const manifest of recoverableManifests) {
      await coordinator.resume(manifest);
    }
  } catch (error) {
    logger.error(
      { errorType: error instanceof Error ? error.name : typeof error },
      "Falha ao recuperar gravações anteriores",
    );
  }
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Encerramento do Summyz solicitado");
  await coordinator.shutdown();
  client.destroy();
  logger.info("Summyz encerrado");
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.fatal(
    { errorType: error instanceof Error ? error.name : typeof error },
    "Não foi possível conectar o Summyz ao Discord",
  );
  process.exitCode = 1;
}
