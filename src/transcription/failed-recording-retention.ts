import type { Logger } from "pino";

import type { TranscriptionStore } from "./transcription-store.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

interface FailedRecordingRetentionOptions {
  logger: Logger;
  retentionHours: number;
  store: TranscriptionStore;
}

export class FailedRecordingRetention {
  readonly #logger: Logger;
  readonly #retentionMs: number;
  readonly #store: TranscriptionStore;
  #timer: NodeJS.Timeout | undefined;

  public constructor(options: FailedRecordingRetentionOptions) {
    this.#logger = options.logger;
    this.#retentionMs = options.retentionHours * 60 * 60 * 1_000;
    this.#store = options.store;
  }

  public start(): void {
    if (this.#timer !== undefined) {
      return;
    }
    void this.cleanup().catch((error: unknown) => {
      this.#logger.error(
        { errorType: getErrorType(error) },
        "Falha ao verificar retenção de gravações",
      );
    });
    this.#timer = setInterval(() => {
      void this.cleanup().catch((error: unknown) => {
        this.#logger.error(
          { errorType: getErrorType(error) },
          "Falha ao verificar retenção de gravações",
        );
      });
    }, CLEANUP_INTERVAL_MS);
    this.#timer.unref();
  }

  public stop(): void {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
  }

  public async cleanup(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - this.#retentionMs).toISOString();
    const meetingIds = await this.#store.listFailuresBefore(cutoff);
    for (const meetingId of meetingIds) {
      try {
        await this.#store.deleteMeeting(meetingId);
        this.#logger.info({ meetingId }, "Gravação com transcrição perdida excluída");
      } catch (error) {
        this.#logger.error(
          { errorType: getErrorType(error), meetingId },
          "Falha ao excluir gravação com retenção expirada",
        );
      }
    }
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
