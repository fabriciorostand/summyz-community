import type { Logger } from "pino";

import type { MeetingPublisher } from "../discord/discord-meeting-publisher.js";
import type { RecordingManifest } from "../recording/manifest.js";
import { assembleTranscriptEntries } from "../transcription/transcript-assembler.js";
import type { TranscribedSegment } from "../transcription/transcription-provider.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
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
  summaryStore: SummaryStore;
  transcriptionStore: TranscriptionStore;
}

export class MeetingSummaryService {
  readonly #generator: SummaryGenerator;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #publisher: MeetingPublisher;
  readonly #summaryStore: SummaryStore;
  readonly #transcriptionStore: TranscriptionStore;

  public constructor(options: MeetingSummaryServiceOptions) {
    this.#generator = options.generator;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#publisher = options.publisher;
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

    state ??= createSummaryState(manifest.meetingId, this.#now().toISOString());
    await this.#summaryStore.save(state);
    this.#logger.info({ meetingId: manifest.meetingId }, "Processamento do resumo iniciado");

    let generated: MeetingSummaryGenerationResult;
    try {
      const entries = assembleTranscriptEntries(manifest, toTranscribedSegments(transcription));
      generated = await this.#generator.generate(entries);
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

function toTranscribedSegments(state: TranscriptionState): TranscribedSegment[] {
  return state.segments.map((segment) => {
    if (segment.status !== "completed") {
      throw new Error("A transcrição concluída contém segmentos pendentes");
    }
    return {
      ...(segment.audioDurationMs === undefined
        ? {}
        : { audioDurationMs: segment.audioDurationMs }),
      pieces: segment.pieces,
      segmentId: segment.segmentId,
      ...(segment.timelineStartedAtMs === undefined
        ? {}
        : { timelineStartedAtMs: segment.timelineStartedAtMs }),
    };
  });
}

function getAttemptCount(error: unknown): number {
  return error instanceof Error && "attempts" in error && typeof error.attempts === "number"
    ? error.attempts
    : 0;
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
