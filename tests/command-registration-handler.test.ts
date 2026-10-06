import { type Events, REST } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { loadConfig, resolveBotConfig } from "../src/config.js";
import { installCommandRegistrationHandler } from "../src/discord/command-registration-handler.js";

const applicationId = "1".repeat(18);
const firstGuildId = "2".repeat(18);
const secondGuildId = "3".repeat(18);
const commandId = "4".repeat(18);
const route = (guildId: string) => `/applications/${applicationId}/guilds/${guildId}/commands`;

function createFixture(guildIds: string[] = [firstGuildId, secondGuildId]) {
  let ready:
    | ((client: { guilds: { cache: ReadonlyMap<string, unknown> } }) => Promise<void>)
    | undefined;
  let joined: ((guild: { id: string }) => Promise<void>) | undefined;
  const client = {
    once: (_event: Events.ClientReady, listener: NonNullable<typeof ready>) => {
      ready = listener;
    },
    on: (_event: Events.GuildCreate, listener: NonNullable<typeof joined>) => {
      joined = listener;
    },
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const config = resolveBotConfig(
    loadConfig({
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 8).toString("base64url"),
    }),
    { discordApplicationId: applicationId, discordToken: "test-discord-token" },
  );
  const get = vi.spyOn(REST.prototype, "get").mockImplementation(async (path) => {
    const guildId = guildIds.find((id) => path === route(id));
    return guildId === undefined
      ? []
      : [
          {
            application_id: applicationId,
            guild_id: guildId,
            id: commandId,
            name: "record",
            type: 1,
          },
        ];
  });
  const post = vi.spyOn(REST.prototype, "post").mockResolvedValue({});
  const remove = vi.spyOn(REST.prototype, "delete").mockResolvedValue(undefined);
  installCommandRegistrationHandler(client, config, logger);
  return {
    get,
    post,
    remove,
    logger,
    ready: async () => {
      if (ready === undefined) throw new Error("Missing ready handler");
      await ready({ guilds: { cache: new Map(guildIds.map((id) => [id, {}])) } });
    },
    join: async (guildId: string) => {
      if (joined === undefined) throw new Error("Missing join handler");
      await joined({ id: guildId });
    },
  };
}

describe("automatic command reconciliation", () => {
  it("publishes globally before cleaning up every installed guild on startup", async () => {
    const fixture = createFixture();

    await fixture.ready();

    expect(fixture.remove.mock.calls).toEqual([
      [`${route(firstGuildId)}/${commandId}`],
      [`${route(secondGuildId)}/${commandId}`],
    ]);
    expect(fixture.post.mock.invocationCallOrder.at(-1)).toBeLessThan(
      fixture.remove.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("cleans a guild when the bot joins after startup", async () => {
    const fixture = createFixture([firstGuildId]);
    await fixture.ready();
    fixture.get.mockResolvedValueOnce([
      {
        application_id: applicationId,
        guild_id: secondGuildId,
        id: commandId,
        name: "recording-cost",
        type: 1,
      },
    ]);

    await fixture.join(secondGuildId);

    expect(fixture.remove).toHaveBeenLastCalledWith(`${route(secondGuildId)}/${commandId}`);
    expect(fixture.post).toHaveBeenCalledTimes(6);
  });

  it("ignores initial guild events until global registration starts", async () => {
    const fixture = createFixture();

    await fixture.join(firstGuildId);
    expect(fixture.get).not.toHaveBeenCalled();
    await fixture.ready();
    expect(fixture.remove).toHaveBeenCalledTimes(2);
  });

  it("does not clean any guild when publishing the current catalog fails", async () => {
    const fixture = createFixture();
    fixture.post.mockRejectedValueOnce(new Error("Bot test-discord-token registration failed"));

    await fixture.ready();
    await fixture.join(firstGuildId);

    expect(fixture.remove).not.toHaveBeenCalled();
    expect(fixture.logger.error).toHaveBeenCalled();
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toContain("test-discord-token");
  });

  it("waits for global publication before cleaning a guild that joins during startup", async () => {
    const fixture = createFixture([firstGuildId]);
    let resolvePublication: ((value: unknown) => void) | undefined;
    const publication = new Promise<unknown>((resolve) => {
      resolvePublication = resolve;
    });
    fixture.post.mockReturnValueOnce(publication);
    const ready = fixture.ready();
    await vi.waitFor(() => expect(fixture.post).toHaveBeenCalledTimes(1));
    const originalGet = fixture.get.getMockImplementation();
    fixture.get.mockImplementation(async (path, options) => {
      if (path === route(secondGuildId)) {
        return [
          {
            application_id: applicationId,
            guild_id: secondGuildId,
            id: commandId,
            name: "record",
            type: 1,
          },
        ];
      }
      if (originalGet === undefined) throw new Error("Missing REST mock");
      return originalGet(path, options);
    });

    const joined = fixture.join(secondGuildId);
    expect(fixture.remove).not.toHaveBeenCalled();
    if (resolvePublication === undefined) throw new Error("Missing publication resolver");
    resolvePublication({});
    await Promise.all([ready, joined]);

    expect(fixture.remove).toHaveBeenCalledWith(`${route(secondGuildId)}/${commandId}`);
    expect(fixture.post.mock.invocationCallOrder.at(-1)).toBeLessThan(
      fixture.remove.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("rejects an invalid join ID without logging its contents or making a request", async () => {
    const fixture = createFixture([]);
    await fixture.ready();
    fixture.get.mockClear();

    await fixture.join("test-discord-token");

    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.logger.error).toHaveBeenCalledWith(
      { errorType: "InvalidGuildId" },
      "Unable to reconcile guild slash commands",
    );
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toContain("test-discord-token");
  });

  it("continues other guilds when a guild listing fails and handles a failed join", async () => {
    const fixture = createFixture();
    fixture.get.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("Forbidden"));

    await fixture.ready();
    fixture.get.mockRejectedValueOnce(new Error("Forbidden"));
    await fixture.join(firstGuildId);

    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(`${route(secondGuildId)}/${commandId}`);
    expect(fixture.logger.error).toHaveBeenCalledTimes(2);
  });
});
