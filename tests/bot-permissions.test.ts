import { type Client, PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
  BOT_INSTALL_PERMISSIONS,
  BotPermissionMonitor,
  createDiscordBotPermissionReader,
} from "../src/discord/bot-permissions.js";

describe("bot permissions", () => {
  it("requests only the permissions needed for recording, publication, and deletion evidence", () => {
    const expected = [
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.SendMessagesInThreads,
    ].reduce((bits, permission) => bits | permission, 0n);

    expect(BOT_INSTALL_PERMISSIONS).toBe(expected.toString());
    expect(expected & PermissionFlagsBits.SendTTSMessages).toBe(0n);
    expect(expected & PermissionFlagsBits.ManageThreads).toBe(0n);
    expect(expected & PermissionFlagsBits.CreatePublicThreads).toBe(0n);
    expect(expected & PermissionFlagsBits.UseApplicationCommands).toBe(0n);
  });

  it("logs effective missing permissions for the guild and the channels used by a recording", async () => {
    const warn = vi.fn();
    const monitor = new BotPermissionMonitor(
      {
        readGuild: vi.fn(async () => 0n),
        readChannel: vi.fn(async (_guildId, channelId) =>
          channelId === "voice-1" ? PermissionFlagsBits.ViewChannel : 0n,
        ),
      },
      { warn },
    );

    await monitor.checkRecording({
      forumId: "forum-1",
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "guild",
        guildId: "guild-1",
        missingPermissions: ["ViewAuditLog"],
      }),
      "Bot permissions are insufficient",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "voice-1",
        context: "voice",
        missingPermissions: ["Connect"],
      }),
      "Bot permissions are insufficient",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "forum-1",
        context: "forum",
        missingPermissions: [
          "ViewChannel",
          "SendMessages",
          "SendMessagesInThreads",
          "AttachFiles",
          "ReadMessageHistory",
        ],
      }),
      "Bot permissions are insufficient",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "text-1",
        context: "notification",
        missingPermissions: ["ViewChannel", "SendMessages"],
      }),
      "Bot permissions are insufficient",
    );
  });

  it("deduplicates unchanged warnings and logs again after permissions recover and regress", async () => {
    const warn = vi.fn();
    let permissions = 0n;
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => permissions,
        readChannel: async () => 0n,
      },
      { warn },
    );

    await monitor.checkGuild("guild-1");
    await monitor.checkGuild("guild-1");
    expect(warn).toHaveBeenCalledTimes(1);
    permissions = PermissionFlagsBits.ViewAuditLog;
    await monitor.checkGuild("guild-1");
    permissions = 0n;
    await monitor.checkGuild("guild-1");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("recognizes Administrator as effective permission instead of reporting false gaps", async () => {
    const warn = vi.fn();
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => PermissionFlagsBits.Administrator,
        readChannel: async () => PermissionFlagsBits.Administrator,
      },
      { warn },
    );

    await monitor.checkRecording({
      forumId: "forum-1",
      guildId: "guild-1",
      notificationChannelId: "text-1",
      voiceChannelId: "voice-1",
    });

    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the bot's current guild and channel permissions from Discord", async () => {
    const botMember = { permissions: { bitfield: PermissionFlagsBits.ViewAuditLog } };
    const fetchMe = vi.fn(async () => botMember);
    const fetchChannel = vi.fn(async (channelId: string) =>
      channelId === "missing" ? null : { permissionsFor: () => ({ bitfield: 0n }) },
    );
    const client = {
      guilds: {
        fetch: vi.fn(async () => ({
          channels: { fetch: fetchChannel },
          members: { fetchMe },
        })),
      },
    } as unknown as Client;
    const reader = createDiscordBotPermissionReader(client);

    await expect(reader.readGuild("guild-1")).resolves.toBe(PermissionFlagsBits.ViewAuditLog);
    await expect(reader.readChannel("guild-1", "forum-1")).resolves.toBe(0n);
    await expect(reader.readChannel("guild-1", "missing")).resolves.toBeNull();
    expect(fetchMe).toHaveBeenCalledTimes(3);
    expect(fetchChannel).toHaveBeenCalledWith("forum-1", { force: true });
  });

  it("treats channels with no computable permission view as unavailable", async () => {
    const client = {
      guilds: {
        fetch: vi.fn(async () => ({
          channels: {
            fetch: vi.fn(async () => ({ permissionsFor: () => null })),
          },
          members: { fetchMe: vi.fn(async () => ({ id: "bot-1" })) },
        })),
      },
    } as unknown as Client;

    await expect(
      createDiscordBotPermissionReader(client).readChannel("guild-1", "forum-1"),
    ).resolves.toBeNull();
  });

  it("updates the warning when the missing permissions change", async () => {
    const warn = vi.fn();
    let permissions = 0n;
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => PermissionFlagsBits.ViewAuditLog,
        readChannel: async () => permissions,
      },
      { warn },
    );

    await monitor.checkPublication("guild-1", "forum-1");
    permissions = PermissionFlagsBits.ViewChannel;
    await monitor.checkPublication("guild-1", "forum-1");

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toMatchObject({
      missingPermissions: [
        "SendMessages",
        "SendMessagesInThreads",
        "AttachFiles",
        "ReadMessageHistory",
      ],
    });
  });

  it("identifies an inaccessible publication forum without repeated warnings", async () => {
    const warn = vi.fn();
    let unavailable = true;
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => PermissionFlagsBits.ViewAuditLog,
        readChannel: async () => (unavailable ? null : PermissionFlagsBits.Administrator),
      },
      { warn },
    );

    await monitor.checkPublication("guild-1", "forum-1");
    await monitor.checkPublication("guild-1", "forum-1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "forum-1",
        context: "forum",
        errorType: "ChannelUnavailable",
      }),
      "Unable to inspect bot permissions",
    );
    unavailable = false;
    await monitor.checkPublication("guild-1", "forum-1");
    unavailable = true;
    await monitor.checkPublication("guild-1", "forum-1");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("bounds retained diagnostic state as recordings use new channels", async () => {
    const warn = vi.fn();
    const monitor = new BotPermissionMonitor(
      { readGuild: async () => 0n, readChannel: async () => 0n },
      { warn },
    );
    for (let index = 0; index <= 1_000; index += 1) {
      await monitor.checkPublication("guild-1", `forum-${index}`);
    }
    await monitor.checkPublication("guild-1", "forum-0");
    expect(warn).toHaveBeenCalledTimes(1_002);
  });

  it("logs failed checks without leaking credential-bearing errors", async () => {
    const warn = vi.fn();
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => {
          throw new Error("authorization: sensitive-token");
        },
        readChannel: async () => null,
      },
      { warn },
    );

    await monitor.checkGuild("guild-1");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-token");
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ context: "guild", errorType: "Error", guildId: "guild-1" }),
      "Unable to inspect bot permissions",
    );
  });

  it("does not log primitive error details from Discord responses", async () => {
    const warn = vi.fn();
    const monitor = new BotPermissionMonitor(
      {
        readGuild: async () => 0n,
        readChannel: async () => {
          throw "sensitive-token";
        },
      },
      { warn },
    );

    await monitor.checkPublication("guild-1", "forum-1");
    await monitor.checkPublication("guild-1", "forum-1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "forum-1", errorType: "string" }),
      "Unable to inspect bot permissions",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive-token");
  });
});
