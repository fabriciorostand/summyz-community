import type { Logger } from "pino";

export type GuildMembership = "absent" | "present" | "unknown";

export class GuildMembershipVerifier {
  readonly #fetchGuild: (guildId: string) => Promise<unknown>;
  readonly #logger: Pick<Logger, "warn">;
  readonly #timeoutMs: number;

  public constructor(
    fetchGuild: (guildId: string) => Promise<unknown>,
    logger: Pick<Logger, "warn">,
    timeoutMs = 10_000,
  ) {
    this.#fetchGuild = fetchGuild;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  public async check(guildId: string): Promise<GuildMembership> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.#timeoutMs);
      timer.unref();
    });
    try {
      const result = await Promise.race([
        this.#fetchGuild(guildId).then(() => "present" as const),
        timeout,
      ]);
      if (result === "timeout") {
        this.#logger.warn(
          { errorType: "TimeoutError", guildId },
          "Unable to verify bot guild membership",
        );
        return "unknown";
      }
      return "present";
    } catch (error) {
      if (isConfirmedDeparture(error)) return "absent";
      this.#logger.warn(
        { errorType: error instanceof Error ? error.name : typeof error, guildId },
        "Unable to verify bot guild membership",
      );
      return "unknown";
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function isConfirmedDeparture(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === 10004 || error.code === 50001;
}
