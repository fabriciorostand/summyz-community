import type { Logger } from "pino";

interface RecoveryQueue {
  recoverEligibleTranscriptions(recoveryVersion: number): Promise<string[]>;
}

interface TerminalMeetingStore {
  listTerminalMeetingIds(): Promise<string[]>;
}

interface MeetingArtifactMaintenanceOptions {
  cleanup(meetingId: string): Promise<void>;
  intervalMs?: number;
  logger: Logger;
  meetingStore: TerminalMeetingStore;
  queue: RecoveryQueue;
  recoveryVersion: number;
}

const DEFAULT_MAINTENANCE_INTERVAL_MS = 60_000;

export class MeetingArtifactMaintenance {
  readonly #cleanup: (meetingId: string) => Promise<void>;
  readonly #intervalMs: number;
  readonly #logger: Logger;
  readonly #meetingStore: TerminalMeetingStore;
  readonly #queue: RecoveryQueue;
  readonly #recoveryVersion: number;
  #active: Promise<void> | undefined;
  #timer: NodeJS.Timeout | undefined;

  public constructor(options: MeetingArtifactMaintenanceOptions) {
    this.#cleanup = options.cleanup;
    this.#intervalMs = options.intervalMs ?? DEFAULT_MAINTENANCE_INTERVAL_MS;
    this.#logger = options.logger;
    this.#meetingStore = options.meetingStore;
    this.#queue = options.queue;
    this.#recoveryVersion = options.recoveryVersion;
  }

  public start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.#poll(), this.#intervalMs);
    this.#timer.unref();
  }

  public async runOnce(): Promise<void> {
    const recoveredMeetingIds = await this.#queue.recoverEligibleTranscriptions(
      this.#recoveryVersion,
    );
    for (const meetingId of recoveredMeetingIds) {
      this.#logger.info(
        { meetingId, transcriptionRecoveryVersion: this.#recoveryVersion },
        "Failed transcription scheduled after a recovery version change",
      );
    }
    for (const meetingId of await this.#meetingStore.listTerminalMeetingIds()) {
      await this.#cleanup(meetingId);
    }
  }

  public async shutdown(): Promise<void> {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    await this.#active;
  }

  #poll(): void {
    if (this.#active !== undefined) return;
    const operation = this.runOnce().catch((error: unknown) => {
      this.#logger.error(
        { errorType: getErrorType(error) },
        "Meeting artifact and transcription recovery maintenance failed",
      );
    });
    this.#active = operation;
    void operation.finally(() => {
      if (this.#active === operation) this.#active = undefined;
    });
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
