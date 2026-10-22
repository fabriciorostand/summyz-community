import type { Logger } from "pino";
import type { RecordingStopRequest } from "../recording/recording-coordinator.js";

interface GuildDepartureHandlerOptions {
  cancelPending(guildId: string): Promise<string[]>;
  cleanup(meetingId: string): Promise<void>;
  logger: Pick<Logger, "error" | "info">;
  stop(guildId: string, request: RecordingStopRequest): Promise<boolean>;
}

export class GuildDepartureHandler {
  readonly #cancelPending: GuildDepartureHandlerOptions["cancelPending"];
  readonly #cleanup: GuildDepartureHandlerOptions["cleanup"];
  readonly #logger: GuildDepartureHandlerOptions["logger"];
  readonly #stop: GuildDepartureHandlerOptions["stop"];

  public constructor(options: GuildDepartureHandlerOptions) {
    this.#cancelPending = options.cancelPending;
    this.#cleanup = options.cleanup;
    this.#logger = options.logger;
    this.#stop = options.stop;
  }

  public async handle(guildId: string): Promise<void> {
    try {
      await this.#stop(guildId, { reason: "bot_left_guild" });
    } catch (error) {
      this.#logger.error(
        { errorType: error instanceof Error ? error.name : typeof error, guildId },
        "Unable to stop recording after leaving guild",
      );
    }
    const meetingIds = await this.#cancelPending(guildId);
    this.#logger.info(
      { cancelledMeetings: meetingIds.length, guildId },
      "Pending guild meetings cancelled after bot departure",
    );
    for (const meetingId of meetingIds) {
      try {
        await this.#cleanup(meetingId);
      } catch (error) {
        this.#logger.error(
          { errorType: error instanceof Error ? error.name : typeof error, meetingId },
          "Unable to delete temporary files after bot departure",
        );
      }
    }
  }
}
