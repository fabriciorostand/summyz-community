import type { Logger } from "pino";

import type { MeetingPublisher } from "../discord/discord-meeting-publisher.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { RefinementStore } from "../refinement/refinement-store.js";
import type { TranscriptionStore } from "../transcription/transcription-store.js";
import type { MeetingSummaryGenerationResult } from "./meeting-summary-generator.js";
import { createPublicSummary, type SummaryTranscriptEntry } from "./summary-result.js";
import { createSummaryState, markSummaryCompleted, markSummaryFailed } from "./summary-state.js";
import type { SummaryStore } from "./summary-store.js";

export interface SummaryGenerator {
  generate(entries: readonly SummaryTranscriptEntry[]): Promise<MeetingSummaryGenerationResult>;
}

interface MeetingSummaryServiceOptions {
  generator: SummaryGenerator;
  logger: Logger;
  now?: () => Date;
  publisher: MeetingPublisher;
  refinementStore: RefinementStore;
  summaryStore: SummaryStore;
  transcriptionStore: TranscriptionStore;
}

export class MeetingSummaryService {
  readonly #generator: SummaryGenerator;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #publisher: MeetingPublisher;
  readonly #refinementStore: RefinementStore;
  readonly #summaryStore: SummaryStore;
  readonly #transcriptionStore: TranscriptionStore;

  public constructor(options: MeetingSummaryServiceOptions) {
    this.#generator = options.generator;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#publisher = options.publisher;
    this.#refinementStore = options.refinementStore;
    this.#summaryStore = options.summaryStore;
    this.#transcriptionStore = options.transcriptionStore;
  }

  public async process(manifest: RecordingManifest): Promise<void> {
    if (manifest.status !== "completed") {
      throw new Error("Somente uma gravação concluída pode gerar resumo");
    }
    const transcription = await this.#transcriptionStore.tryLoad(manifest.meetingId);
    if (transcription?.status !== "completed") {
      return;
    }

    const transcriptPath = this.#transcriptionStore.transcriptPath(manifest.meetingId);
    let state = await this.#summaryStore.tryLoad(manifest.meetingId);
    if (state?.status === "completed") {
      await this.#publisher.publishSummary(
        manifest,
        createPublicSummary(state.summary),
        transcriptPath,
      );
      return;
    }
    if (state?.status === "failed") {
      await this.#publisher.publishTranscriptOnly(manifest, transcriptPath);
      return;
    }
    const refinement = await this.#refinementStore.tryLoad(manifest.meetingId);
    if (refinement?.status !== "completed" && refinement?.status !== "fallback") {
      return;
    }

    state ??= createSummaryState(manifest.meetingId, this.#now().toISOString());
    await this.#summaryStore.save(state);
    this.#logger.info({ meetingId: manifest.meetingId }, "Processamento do resumo iniciado");

    let generated: MeetingSummaryGenerationResult;
    try {
      generated = await this.#generator.generate(refinement.entries);
    } catch (error) {
      const failed = markSummaryFailed(
        state,
        "provider_failed",
        getAttemptCount(error),
        this.#now().toISOString(),
      );
      await this.#summaryStore.save(failed);
      this.#logger.error(
        { errorType: getErrorType(error), meetingId: manifest.meetingId },
        "Falha ao gerar resumo da reunião",
      );
      await this.#publisher.publishTranscriptOnly(manifest, transcriptPath);
      return;
    }

    const completed = markSummaryCompleted(
      state,
      generated.summary,
      generated.attempts,
      this.#now().toISOString(),
    );
    await this.#summaryStore.save(completed);
    this.#logger.info(
      { attempts: generated.attempts, meetingId: manifest.meetingId },
      "Resumo da reunião concluído",
    );
    await this.#publisher.publishSummary(
      manifest,
      createPublicSummary(completed.summary),
      transcriptPath,
    );
  }
}

function getAttemptCount(error: unknown): number {
  return error instanceof Error && "attempts" in error && typeof error.attempts === "number"
    ? error.attempts
    : 0;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
