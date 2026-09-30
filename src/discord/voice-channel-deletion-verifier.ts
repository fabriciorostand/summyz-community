import { ChannelType } from "discord.js";
import type { Logger } from "pino";

export type VoiceChannelAvailability = "deleted" | "exists" | "unknown";

export class VoiceChannelDeletionVerifier {
  readonly #fetchChannel: (channelId: string) => Promise<unknown>;
  readonly #hasAuditEvidence: (
    guildId: string,
    channelId: string,
    startedAt: string,
  ) => Promise<boolean>;
  readonly #logger: Pick<Logger, "warn">;
  readonly #pending = new Map<string, Promise<VoiceChannelAvailability>>();
  readonly #gatewayDeletions = new Map<string, number>();
  readonly #timeoutMs: number;

  public constructor(
    fetchChannel: (channelId: string) => Promise<unknown>,
    hasAuditEvidence: (guildId: string, channelId: string, startedAt: string) => Promise<boolean>,
    logger: Pick<Logger, "warn">,
    timeoutMs: number,
  ) {
    this.#fetchChannel = fetchChannel;
    this.#hasAuditEvidence = hasAuditEvidence;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  public noteDeletion(guildId: string, channelId: string, deletedAt = Date.now()): void {
    const key = `${guildId}:${channelId}`;
    this.#gatewayDeletions.delete(key);
    this.#gatewayDeletions.set(key, deletedAt);
    if (this.#gatewayDeletions.size > 1_000) {
      const oldestKey = this.#gatewayDeletions.keys().next().value;
      if (oldestKey !== undefined) this.#gatewayDeletions.delete(oldestKey);
    }
  }

  public async check(
    guildId: string,
    channelId: string,
    startedAt: string,
  ): Promise<VoiceChannelAvailability> {
    const deletedAt = this.#gatewayDeletions.get(`${guildId}:${channelId}`);
    if (deletedAt !== undefined && deletedAt >= Date.parse(startedAt)) return "deleted";
    const key = `${guildId}:${channelId}:${startedAt}`;
    let pending = this.#pending.get(key);
    if (pending === undefined) {
      pending = this.#lookup(guildId, channelId, startedAt);
      this.#pending.set(key, pending);
      const current = pending;
      void pending.then(() => {
        if (this.#pending.get(key) === current) this.#pending.delete(key);
      });
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"unknown">((resolve) => {
      timer = setTimeout(() => resolve("unknown"), this.#timeoutMs);
      timer.unref();
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #lookup(
    guildId: string,
    channelId: string,
    startedAt: string,
  ): Promise<VoiceChannelAvailability> {
    try {
      const channel = await this.#fetchChannel(channelId);
      return channel !== null &&
        typeof channel === "object" &&
        "type" in channel &&
        channel.type === ChannelType.GuildVoice
        ? "exists"
        : "unknown";
    } catch (error) {
      if (isDeletedChannelError(error)) {
        return this.#checkAuditEvidence(guildId, channelId, startedAt);
      }
      this.#logger.warn(
        { channelId, errorType: error instanceof Error ? error.name : typeof error },
        "Unable to verify voice channel availability",
      );
      return "unknown";
    }
  }

  async #checkAuditEvidence(
    guildId: string,
    channelId: string,
    startedAt: string,
  ): Promise<VoiceChannelAvailability> {
    try {
      return (await this.#hasAuditEvidence(guildId, channelId, startedAt)) ? "deleted" : "unknown";
    } catch (error) {
      this.#logger.warn(
        { guildId, channelId, errorType: error instanceof Error ? error.name : typeof error },
        "Unable to verify channel deletion through audit log",
      );
      return "unknown";
    }
  }
}

function isDeletedChannelError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 10003 &&
    "status" in error &&
    error.status === 404
  );
}
