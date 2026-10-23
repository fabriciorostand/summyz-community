import { setTimeout as delay } from "node:timers/promises";

interface StoredBotConfiguration {
  discordApplicationId: string | null;
  discordToken: string | undefined;
  setupCompleted: boolean;
  version: string;
}

interface WaitForBotConfigurationOptions {
  delay?: () => Promise<void>;
  read(): Promise<StoredBotConfiguration>;
}

export async function waitForBotConfiguration(
  options: WaitForBotConfigurationOptions,
): Promise<{ discordApplicationId: string; discordToken: string; version: string }> {
  const wait = options.delay ?? (() => delay(5_000));
  for (;;) {
    const configuration = await options.read();
    if (
      configuration.setupCompleted &&
      configuration.discordApplicationId !== null &&
      configuration.discordToken !== undefined
    ) {
      return {
        discordApplicationId: configuration.discordApplicationId,
        discordToken: configuration.discordToken,
        version: configuration.version,
      };
    }
    await wait();
  }
}
