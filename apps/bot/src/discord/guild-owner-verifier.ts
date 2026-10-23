import type { Logger } from "pino";
import type { GuildAccessResult } from "./guild-ownership-handler.js";

type OwnerCheck = { ownerId: string; confirmed: boolean };
type PendingResult = { kind: "resolved"; value: OwnerCheck } | { kind: "failed" };

export class GuildOwnerVerifier {
  readonly #fetchOwnerId: (guildId: string) => Promise<string>;
  readonly #isConfirmed: (guildId: string, ownerId: string) => Promise<boolean>;
  readonly #logger: Pick<Logger, "warn">;
  readonly #pending = new Map<string, Promise<PendingResult>>();
  readonly #timeoutMs: number;

  public constructor(
    fetchOwnerId: (guildId: string) => Promise<string>,
    isConfirmed: (guildId: string, ownerId: string) => Promise<boolean>,
    logger: Pick<Logger, "warn">,
    timeoutMs: number,
  ) {
    this.#fetchOwnerId = fetchOwnerId;
    this.#isConfirmed = isConfirmed;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  public async check(guildId: string, connectedUserId: string): Promise<GuildAccessResult> {
    let pending = this.#pending.get(guildId);
    if (pending === undefined) {
      pending = this.#lookup(guildId);
      this.#pending.set(guildId, pending);
      const current = pending;
      void pending.then(() => {
        if (this.#pending.get(guildId) === current) this.#pending.delete(guildId);
      });
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.#timeoutMs);
      timer.unref();
    });
    try {
      const result = await Promise.race([pending, timeout]);
      if (result === null || result.kind === "failed") {
        return { status: "unknown", connectedUserId };
      }
      if (result.value.ownerId !== connectedUserId) {
        return { status: "denied", connectedUserId, reason: "different_owner" };
      }
      return result.value.confirmed
        ? { status: "allowed", connectedUserId }
        : { status: "denied", connectedUserId, reason: "approval_missing" };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async #lookup(guildId: string): Promise<PendingResult> {
    try {
      const ownerId = await this.#fetchOwnerId(guildId);
      const confirmed = await this.#isConfirmed(guildId, ownerId);
      return { kind: "resolved", value: { confirmed, ownerId } };
    } catch (error) {
      this.#logger.warn(
        { errorType: error instanceof Error ? error.name : typeof error, guildId },
        "Unable to verify guild ownership",
      );
      return { kind: "failed" };
    }
  }
}
