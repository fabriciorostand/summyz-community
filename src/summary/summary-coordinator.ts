import type { Logger } from "pino";

import type { RecordingManifest } from "../recording/manifest.js";

export interface MeetingSummarizer {
  process(manifest: RecordingManifest): Promise<void>;
}

export class SummaryCoordinator {
  readonly #active = new Map<string, Promise<void>>();
  readonly #logger: Logger;
  readonly #summarizer: MeetingSummarizer;

  public constructor(summarizer: MeetingSummarizer, logger: Logger) {
    this.#summarizer = summarizer;
    this.#logger = logger;
  }

  public start(manifest: RecordingManifest): boolean {
    if (this.#active.has(manifest.meetingId)) {
      return false;
    }
    const operation = this.#summarizer
      .process(manifest)
      .catch((error: unknown) => {
        this.#logger.error(
          { errorType: getErrorType(error), meetingId: manifest.meetingId },
          "Falha inesperada no coordenador de resumo e publicação",
        );
      })
      .finally(() => {
        if (this.#active.get(manifest.meetingId) === operation) {
          this.#active.delete(manifest.meetingId);
        }
      });
    this.#active.set(manifest.meetingId, operation);
    return true;
  }

  public async shutdown(): Promise<void> {
    await Promise.allSettled(this.#active.values());
    this.#active.clear();
  }
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
