import { setTimeout as delay } from "node:timers/promises";

interface StoredBotConfiguration {
  discordClientId: string | null;
  discordToken: string | undefined;
  setupCompleted: boolean;
}

interface WaitForBotConfigurationOptions {
  delay?: () => Promise<void>;
  read(): Promise<StoredBotConfiguration>;
}

export async function waitForBotConfiguration(
  options: WaitForBotConfigurationOptions,
): Promise<{ discordClientId: string; discordToken: string }> {
  const wait = options.delay ?? (() => delay(5_000));
  for (;;) {
    const configuration = await options.read();
    if (
      configuration.setupCompleted &&
      configuration.discordClientId !== null &&
      configuration.discordToken !== undefined
    ) {
      return {
        discordClientId: configuration.discordClientId,
        discordToken: configuration.discordToken,
      };
    }
    await wait();
  }
}
