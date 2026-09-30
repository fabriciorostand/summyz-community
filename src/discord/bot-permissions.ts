import { type Client, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import type { Logger } from "pino";

const installPermissions = [
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.SendMessagesInThreads,
];

export const BOT_INSTALL_PERMISSIONS = installPermissions
  .reduce((bits, permission) => bits | permission, 0n)
  .toString();

const requiredPermissions = {
  guild: [["ViewAuditLog", PermissionFlagsBits.ViewAuditLog]],
  voice: [
    ["ViewChannel", PermissionFlagsBits.ViewChannel],
    ["Connect", PermissionFlagsBits.Connect],
  ],
  forum: [
    ["ViewChannel", PermissionFlagsBits.ViewChannel],
    ["SendMessages", PermissionFlagsBits.SendMessages],
    ["SendMessagesInThreads", PermissionFlagsBits.SendMessagesInThreads],
    ["AttachFiles", PermissionFlagsBits.AttachFiles],
    ["ReadMessageHistory", PermissionFlagsBits.ReadMessageHistory],
  ],
  notification: [
    ["ViewChannel", PermissionFlagsBits.ViewChannel],
    ["SendMessages", PermissionFlagsBits.SendMessages],
  ],
} as const;

type PermissionContext = keyof typeof requiredPermissions;

export interface BotPermissionReader {
  readGuild(guildId: string): Promise<bigint>;
  readChannel(guildId: string, channelId: string): Promise<bigint | null>;
}

export function createDiscordBotPermissionReader(client: Client): BotPermissionReader {
  return {
    readGuild: async (guildId) => {
      const guild = await client.guilds.fetch({ guild: guildId, force: true });
      const member = await guild.members.fetchMe();
      return member.permissions.bitfield;
    },
    readChannel: async (guildId, channelId) => {
      const guild = await client.guilds.fetch({ guild: guildId, force: true });
      const member = await guild.members.fetchMe();
      const channel = await guild.channels.fetch(channelId, { force: true });
      return channel?.permissionsFor(member)?.bitfield ?? null;
    },
  };
}

export interface RecordingPermissionContext {
  forumId: string;
  guildId: string;
  notificationChannelId: string;
  voiceChannelId: string;
}

export class BotPermissionMonitor {
  readonly #reader: BotPermissionReader;
  readonly #logger: Pick<Logger, "warn">;
  readonly #reported = new Map<string, string>();

  public constructor(reader: BotPermissionReader, logger: Pick<Logger, "warn">) {
    this.#reader = reader;
    this.#logger = logger;
  }

  public async checkGuild(guildId: string): Promise<void> {
    await this.#check("guild", guildId);
  }

  public async checkRecording(context: RecordingPermissionContext): Promise<void> {
    await Promise.all([
      this.checkGuild(context.guildId),
      this.#check("voice", context.guildId, context.voiceChannelId),
      this.#check("forum", context.guildId, context.forumId),
      this.#check("notification", context.guildId, context.notificationChannelId),
    ]);
  }

  public async checkPublication(guildId: string, forumId: string): Promise<void> {
    await this.#check("forum", guildId, forumId);
  }

  async #check(context: PermissionContext, guildId: string, channelId?: string): Promise<void> {
    const key = `${guildId}:${context}:${channelId ?? ""}`;
    try {
      const permissions =
        channelId === undefined
          ? await this.#reader.readGuild(guildId)
          : await this.#reader.readChannel(guildId, channelId);
      if (permissions === null) {
        this.#warnUnavailable(key, context, guildId, channelId, "ChannelUnavailable");
        return;
      }
      const effective = new PermissionsBitField(permissions);
      const missingPermissions = requiredPermissions[context]
        .filter(([, permission]) => !effective.has(permission))
        .map(([name]) => name);
      if (missingPermissions.length === 0) {
        this.#reported.delete(key);
        return;
      }
      const signature = missingPermissions.join(",");
      if (this.#reported.get(key) === signature) return;
      this.#remember(key, signature);
      this.#logger.warn(
        { context, guildId, ...(channelId === undefined ? {} : { channelId }), missingPermissions },
        "Bot permissions are insufficient",
      );
    } catch (error) {
      this.#warnUnavailable(
        key,
        context,
        guildId,
        channelId,
        error instanceof Error ? error.name : typeof error,
      );
    }
  }

  #warnUnavailable(
    key: string,
    context: PermissionContext,
    guildId: string,
    channelId: string | undefined,
    errorType: string,
  ): void {
    const signature = `unavailable:${errorType}`;
    if (this.#reported.get(key) === signature) return;
    this.#remember(key, signature);
    this.#logger.warn(
      { context, errorType, guildId, ...(channelId === undefined ? {} : { channelId }) },
      "Unable to inspect bot permissions",
    );
  }

  #remember(key: string, signature: string): void {
    this.#reported.delete(key);
    this.#reported.set(key, signature);
    if (this.#reported.size > 1_000) {
      const oldest = this.#reported.keys().next().value;
      if (oldest !== undefined) this.#reported.delete(oldest);
    }
  }
}
