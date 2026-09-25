import type { Logger } from "pino";

import type { MeetingPublisher } from "../discord/discord-meeting-publisher.js";
import type { RecordingManifest } from "../recording/manifest.js";
import type { RefinementStore } from "../refinement/refinement-store.js";
import type { TranscriptionStore } from "../transcription/transcription-store.js";
import type { MeetingSummaryGenerationResult } from "./meeting-summary-generator.js";
import { resolveSummaryLanguage } from "./summary-language.js";
import {
  type SummaryLanguageValidation,
  validateSummaryLanguage,
} from "./summary-language-validator.js";
import {
  createPublicSummary,
  type PublicSummary,
  type SummaryTranscriptEntry,
} from "./summary-result.js";
import {
  createSummaryState,
  markSummaryCompleted,
  markSummaryFailed,
  type SummaryLanguageValidationState,
} from "./summary-state.js";
import type { SummaryStore } from "./summary-store.js";

export interface SummaryGenerator {
  generate(entries: readonly SummaryTranscriptEntry[]): Promise<MeetingSummaryGenerationResult>;
}

interface MeetingSummaryServiceOptions {
  generator?: SummaryGenerator;
  logger: Logger;
  now?: () => Date;
  publisher: MeetingPublisher;
  refinementStore: RefinementStore;
  resolveGenerator?: (manifest: RecordingManifest) => SummaryGenerator | Promise<SummaryGenerator>;
  summaryStore: SummaryStore;
  timeZone?: string;
  transcriptionStore: TranscriptionStore;
  validateLanguage?: (
    summary: PublicSummary,
    expectedLanguage: string,
  ) => SummaryLanguageValidation;
}

interface SummaryProcessingOptions {
  fallbackOnProviderFailure?: boolean;
}

interface ValidatedGeneration {
  generationAttempts: number;
  languageAttempts: number;
  summary: PublicSummary;
  validation: SummaryLanguageValidation;
}

export class MeetingSummaryService {
  readonly #generator: SummaryGenerator | undefined;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #publisher: MeetingPublisher;
  readonly #refinementStore: RefinementStore;
  readonly #resolveGenerator:
    | ((manifest: RecordingManifest) => SummaryGenerator | Promise<SummaryGenerator>)
    | undefined;
  readonly #summaryStore: SummaryStore;
  readonly #transcriptionStore: TranscriptionStore;
  readonly #timeZone: string;
  readonly #validateLanguage: (
    summary: PublicSummary,
    expectedLanguage: string,
  ) => SummaryLanguageValidation;

  public constructor(options: MeetingSummaryServiceOptions) {
    this.#generator = options.generator;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#publisher = options.publisher;
    this.#refinementStore = options.refinementStore;
    this.#resolveGenerator = options.resolveGenerator;
    this.#summaryStore = options.summaryStore;
    this.#transcriptionStore = options.transcriptionStore;
    this.#timeZone = options.timeZone ?? "UTC";
    this.#validateLanguage = options.validateLanguage ?? validateSummaryLanguage;
    if (this.#generator === undefined && this.#resolveGenerator === undefined) {
      throw new Error("A summary generator or resolver is required");
    }
  }

  public async process(
    manifest: RecordingManifest,
    options: SummaryProcessingOptions = {},
  ): Promise<void> {
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
      await this.#publisher.publishSummary(manifest, state.summary, transcriptPath);
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
    this.#logger.info({ meetingId: manifest.meetingId }, "Meeting summary processing started");

    let result: ValidatedGeneration;
    let requestedLanguage: string;
    try {
      requestedLanguage = resolveSummaryLanguage({
        detectedLanguage: manifest.predominantLanguage,
        summaryLanguage: manifest.aiConfiguration?.language ?? "auto",
        transcriptionLanguage: manifest.aiConfiguration?.transcription.language ?? "auto",
      });
      const generator =
        this.#resolveGenerator === undefined
          ? this.#generator
          : await this.#resolveGenerator(manifest);
      if (generator === undefined) throw new Error("The summary generator is unavailable");
      const entries = refinement.entries.map((entry) => ({
        ...entry,
        spokenAt: {
          instant: new Date(
            new Date(manifest.startedAt).getTime() + entry.startedAtMs,
          ).toISOString(),
          timeZone: this.#timeZone,
        },
      }));
      result = await this.#generateValidated(generator, entries, requestedLanguage);
    } catch (error) {
      if (!(options.fallbackOnProviderFailure ?? true)) {
        throw error;
      }
      const failed = markSummaryFailed(
        state,
        "provider_failed",
        getAttemptCount(error),
        this.#now().toISOString(),
      );
      await this.#summaryStore.save(failed);
      this.#logger.error(
        { errorType: getErrorType(error), meetingId: manifest.meetingId },
        "Meeting summary generation failed",
      );
      await this.#publisher.publishTranscriptOnly(manifest, transcriptPath);
      return;
    }

    const languageValidation = createLanguageValidationState(result, requestedLanguage);
    const completed = markSummaryCompleted(
      state,
      result.summary,
      result.generationAttempts,
      this.#now().toISOString(),
      languageValidation,
    );
    await this.#summaryStore.save(completed);
    this.#logger.info(
      { attempts: result.generationAttempts, meetingId: manifest.meetingId },
      "Meeting summary completed",
    );
    if (languageValidation.status === "unconfirmed") {
      this.#logger.warn(
        {
          attempts: languageValidation.attempts,
          meetingId: manifest.meetingId,
          requestedLanguage,
          validationStatus: result.validation.status,
        },
        "Meeting summary language could not be confirmed",
      );
    }
    await this.#publisher.publishSummary(manifest, completed.summary, transcriptPath);
  }

  async #generateValidated(
    generator: SummaryGenerator,
    entries: readonly SummaryTranscriptEntry[],
    requestedLanguage: string,
  ): Promise<ValidatedGeneration> {
    let generationAttempts = 0;
    for (let languageAttempts = 1; languageAttempts <= 3; languageAttempts += 1) {
      const generated = await generator.generate(entries);
      generationAttempts += generated.attempts;
      const summary = createPublicSummary(generated.summary);
      const validation = this.#validateLanguage(summary, requestedLanguage);
      if (validation.status === "confirmed" || languageAttempts === 3) {
        return { generationAttempts, languageAttempts, summary, validation };
      }
    }
    throw new Error("The summary generator did not produce a result");
  }
}

function getAttemptCount(error: unknown): number {
  return error instanceof Error && "attempts" in error && typeof error.attempts === "number"
    ? error.attempts
    : 0;
}

function createLanguageValidationState(
  result: ValidatedGeneration,
  requestedLanguage: string,
): SummaryLanguageValidationState {
  if (result.validation.status === "confirmed") {
    return {
      attempts: result.languageAttempts,
      detectedLanguage: result.validation.detectedLanguage,
      requestedLanguage,
      status: "confirmed",
    };
  }
  return {
    attempts: 3,
    ...(result.validation.status === "wrong"
      ? { detectedLanguage: result.validation.detectedLanguage }
      : {}),
    requestedLanguage,
    status: "unconfirmed",
  };
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
