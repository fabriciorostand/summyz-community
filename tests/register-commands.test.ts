import { REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { loadConfig, resolveBotConfig } from "../src/config.js";
import { registerCommands } from "../src/discord/register-commands.js";

const applicationId = "1".repeat(18);

function createConfig(guildId?: string) {
  const bootstrap = loadConfig({
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 8).toString("base64url"),
    ...(guildId === undefined ? {} : { DISCORD_GUILD_ID: guildId }),
  });
  return resolveBotConfig(bootstrap, {
    discordApplicationId: applicationId,
    discordToken: "test-discord-token",
  });
}

describe("command registration", () => {
  it.each([undefined, "", "987654321098765432"])(
    "registers globally regardless of a legacy development guild setting: %s",
    async (guildId) => {
      const put = vi.spyOn(REST.prototype, "put").mockResolvedValue([]);
      const setToken = vi.spyOn(REST.prototype, "setToken");

      await registerCommands(createConfig(guildId));

      expect(setToken).toHaveBeenCalledWith("test-discord-token");
      expect(put).toHaveBeenCalledExactlyOnceWith(`/applications/${applicationId}/commands`, {
        body: expect.arrayContaining([
          expect.objectContaining({ name: "record" }),
          expect.objectContaining({ name: "stop" }),
        ]),
      });
    },
  );

  it("propagates Discord registration failures to the caller", async () => {
    const error = new Error("Discord registration failed");
    vi.spyOn(REST.prototype, "put").mockRejectedValue(error);

    await expect(registerCommands(createConfig())).rejects.toBe(error);
  });
});
