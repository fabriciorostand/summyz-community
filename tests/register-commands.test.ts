import { DiscordAPIError, REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { loadConfig, resolveBotConfig } from "../src/config.js";
import * as commandDefinitionsModule from "../src/discord/commands.js";
import { registerCommands, removeGuildSlashCommands } from "../src/discord/register-commands.js";

const applicationId = "1".repeat(18);
const guildId = "2".repeat(18);
const commandId = "3".repeat(18);
const globalRoute = `/applications/${applicationId}/commands`;
const guildRoute = `/applications/${applicationId}/guilds/${guildId}/commands`;

function command(name: string, scope?: string, overrides: Record<string, unknown> = {}) {
  return {
    application_id: applicationId,
    id: commandId,
    name,
    type: 1,
    ...(scope === undefined ? {} : { guild_id: scope }),
    ...overrides,
  };
}

function mockRest(commands: unknown = []) {
  return {
    get: vi.spyOn(REST.prototype, "get").mockResolvedValue(commands),
    post: vi.spyOn(REST.prototype, "post").mockResolvedValue({}),
    put: vi.spyOn(REST.prototype, "put").mockResolvedValue([]),
    delete: vi.spyOn(REST.prototype, "delete").mockResolvedValue(undefined),
  };
}

function createLog() {
  return { error: vi.fn(), info: vi.fn() };
}

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
      const rest = mockRest();
      const setToken = vi.spyOn(REST.prototype, "setToken");

      await registerCommands(createConfig(guildId), createLog());

      expect(setToken).toHaveBeenCalledWith("test-discord-token");
      expect(
        rest.post.mock.calls.map(([route, options]) => ({ route, body: options?.body })),
      ).toEqual(
        [
          "record",
          "stop",
          "recording-role",
          "recording-summary-forum",
          "recording-profile",
          "recording-activate",
        ].map((name) => ({ route: globalRoute, body: expect.objectContaining({ name }) })),
      );
      expect(rest.put).not.toHaveBeenCalled();
    },
  );

  it("propagates Discord registration failures to the caller", async () => {
    const error = new Error("Discord registration failed");
    const rest = mockRest([command("recording-cost")]);
    rest.post.mockRejectedValueOnce(error);

    await expect(registerCommands(createConfig(), createLog())).rejects.toBe(error);
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("removes every global slash command absent from the current catalog, regardless of its name", async () => {
    const rest = mockRest([
      command("record"),
      command("recording-cost", undefined, { id: "4".repeat(18) }),
      command("unknown-old-command", undefined, { id: "5".repeat(18) }),
      command("recording-cost", undefined, { id: "6".repeat(18), type: 2 }),
      command("message-command", undefined, { id: "7".repeat(18), type: 3 }),
    ]);

    await registerCommands(createConfig(), createLog());

    expect(rest.delete.mock.calls).toEqual([
      [`${globalRoute}/${"4".repeat(18)}`],
      [`${globalRoute}/${"5".repeat(18)}`],
    ]);
    expect(rest.post.mock.invocationCallOrder.at(-1)).toBeLessThan(
      rest.delete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(rest.put).not.toHaveBeenCalled();
  });

  it("propagates global listing failures without publishing or deleting", async () => {
    const rest = mockRest();
    const error = new Error("Discord unavailable");
    rest.get.mockRejectedValueOnce(error);

    await expect(registerCommands(createConfig(), createLog())).rejects.toBe(error);
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("uses a changed catalog as the sole source of truth without a discontinued-name list", async () => {
    const createDefinitions = commandDefinitionsModule.createCommandDefinitions;
    vi.spyOn(commandDefinitionsModule, "createCommandDefinitions").mockImplementation(() => {
      const definitions = createDefinitions();
      definitions[0].setName("replacement-command");
      return definitions;
    });
    const rest = mockRest([command("record"), command("stop", undefined, { id: "4".repeat(18) })]);

    await registerCommands(createConfig(), createLog());

    expect(rest.post).toHaveBeenCalledWith(globalRoute, {
      body: expect.objectContaining({ name: "replacement-command" }),
    });
    expect(rest.delete).toHaveBeenCalledExactlyOnceWith(`${globalRoute}/${commandId}`);
  });

  it("keeps cleaning other obsolete global commands after a deletion failure", async () => {
    const rest = mockRest([
      command("recording-cost"),
      command("old-command", undefined, { id: "4".repeat(18) }),
    ]);
    rest.delete.mockRejectedValueOnce(new Error("Forbidden"));
    const logger = createLog();

    await registerCommands(createConfig(), logger);

    expect(rest.delete).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ registrationScope: "global", failedCount: 1, removedCount: 1 }),
      "Slash command cleanup completed",
    );
  });

  it.each([
    [command("recording-cost", guildId)],
    [command("recording-cost", undefined, { application_id: "4".repeat(18) })],
  ])("rejects mismatched global responses before publishing or deleting", async (payload) => {
    const rest = mockRest(payload);

    await expect(registerCommands(createConfig(), createLog())).rejects.toThrow();
    expect(rest.post).not.toHaveBeenCalled();
    expect(rest.delete).not.toHaveBeenCalled();
  });
});

describe("guild slash command cleanup", () => {
  it("individually removes duplicates, discontinued and unknown slash commands while preserving other types", async () => {
    const rest = mockRest([
      command("record", guildId),
      command("recording-cost", guildId, { id: "4".repeat(18) }),
      command("unknown-old-command", guildId, { id: "5".repeat(18) }),
      command("record", guildId, { id: "6".repeat(18), type: 2 }),
      command("message-command", guildId, { id: "7".repeat(18), type: 3 }),
    ]);

    await removeGuildSlashCommands(createConfig(), guildId, createLog());

    expect(rest.get).toHaveBeenCalledExactlyOnceWith(guildRoute);
    expect(rest.delete.mock.calls).toEqual([
      [`${guildRoute}/${commandId}`],
      [`${guildRoute}/${"4".repeat(18)}`],
      [`${guildRoute}/${"5".repeat(18)}`],
    ]);
    expect(rest.put).not.toHaveBeenCalled();
    expect(rest.post).not.toHaveBeenCalled();
  });

  it("makes no deletions on a subsequent reconciliation after cleanup", async () => {
    const rest = mockRest();
    rest.get.mockResolvedValueOnce([command("record", guildId)]).mockResolvedValueOnce([]);

    await removeGuildSlashCommands(createConfig(), guildId, createLog());
    await removeGuildSlashCommands(createConfig(), guildId, createLog());

    expect(rest.get).toHaveBeenCalledTimes(2);
    expect(rest.delete).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    [
      {
        id: "../commands",
        name: "record",
        type: 1,
        application_id: applicationId,
        guild_id: guildId,
      },
    ],
    [command("record", guildId), command("stop", guildId, { application_id: "4".repeat(18) })],
    [command("record", "4".repeat(18))],
    [command("record")],
  ])("rejects invalid or mismatched responses before deleting any command: %j", async (payload) => {
    const rest = mockRest(payload);

    await expect(removeGuildSlashCommands(createConfig(), guildId, createLog())).rejects.toThrow();
    expect(rest.delete).not.toHaveBeenCalled();
  });

  it("validates a guild ID before making requests", async () => {
    const rest = mockRest();

    await expect(
      removeGuildSlashCommands(createConfig(), "../commands", createLog()),
    ).rejects.toThrow();
    expect(rest.get).not.toHaveBeenCalled();
  });

  it("continues after a deletion failure and retries the remaining command on the next run", async () => {
    const rest = mockRest([
      command("record", guildId),
      command("stop", guildId, { id: "4".repeat(18) }),
    ]);
    const logger = createLog();
    rest.delete.mockRejectedValueOnce(new Error("Forbidden"));

    await removeGuildSlashCommands(createConfig(), guildId, logger);
    rest.get.mockResolvedValueOnce([command("record", guildId)]);
    await removeGuildSlashCommands(createConfig(), guildId, logger);

    expect(rest.delete.mock.calls).toEqual([
      [`${guildRoute}/${commandId}`],
      [`${guildRoute}/${"4".repeat(18)}`],
      [`${guildRoute}/${commandId}`],
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("accepts a command already deleted by another reconciliation", async () => {
    const rest = mockRest([command("record", guildId)]);
    const logger = createLog();
    rest.delete.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 10063, message: "Unknown application command" },
        10063,
        404,
        "DELETE",
        `${guildRoute}/${commandId}`,
        { body: undefined, files: [] },
      ),
    );

    await removeGuildSlashCommands(createConfig(), guildId, logger);

    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs other Discord errors with a status and code without exposing the request", async () => {
    const secret = createConfig().discordToken;
    const rest = mockRest([command("record", guildId)]);
    rest.delete.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 50001, message: `Missing access: ${secret}` },
        50001,
        403,
        "DELETE",
        `${guildRoute}/${commandId}`,
        { body: { token: secret }, files: [] },
      ),
    );
    const logger = createLog();

    await removeGuildSlashCommands(createConfig(), guildId, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        discordCode: 50001,
        discordStatus: 403,
        errorType: "DiscordAPIError",
      }),
      "Unable to remove obsolete slash command",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
  });

  it("handles non-Error rejections without leaking their contents", async () => {
    const rest = mockRest([command("record", guildId)]);
    rest.delete.mockRejectedValueOnce("test-discord-token");
    const logger = createLog();

    await removeGuildSlashCommands(createConfig(), guildId, logger);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: "string" }),
      "Unable to remove obsolete slash command",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("test-discord-token");
  });

  it("never logs credentials from API payloads or error messages and names", async () => {
    const secret = createConfig().discordToken;
    const rest = mockRest([command("record", guildId, { authorization: `Bot ${secret}` })]);
    const error = new Error(`Authorization: Bot ${secret}`);
    error.name = secret;
    rest.delete.mockRejectedValueOnce(error);
    const logger = createLog();

    await removeGuildSlashCommands(createConfig(), guildId, logger);

    const output = JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls]);
    expect(logger.error).toHaveBeenCalled();
    expect(output).not.toContain(secret);
    expect(output).not.toContain("Authorization");
  });
});
