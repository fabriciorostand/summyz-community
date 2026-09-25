import type { Logger } from "pino";

import { type RecordingManifest, setPredominantLanguage } from "../recording/manifest.js";
import type { ManifestStore } from "../recording/manifest-store.js";
import { mapWithConcurrency } from "./concurrency.js";
import { AudioPreparationError, MeetingAudioPreparer } from "./meeting-audio-preparer.js";
import {
  aggregatePredominantLanguage,
  type LanguageEvidence,
  normalizeDetectedLanguage,
  type PredominantLanguageResult,
} from "./predominant-language.js";
import type { SpeechAnalyzer } from "./speech-analyzer.js";
import { assembleTranscript } from "./transcript-assembler.js";
import { createTranscriptionGroups } from "./transcription-batch.js";
import {
  AudioAnalysisError,
  type PersistTranscriptionGroup,
  processTranscriptionGroup,
} from "./transcription-group-processor.js";
import type { TranscribedSegment, TranscriptionProvider } from "./transcription-provider.js";
import { IncompatibleTranscriptionResponseError } from "./transcription-provider.js";
import type { TranscriptionRecoveryReason } from "./transcription-recovery-policy.js";
import {
  completeTranscriptionGroup,
  createTranscriptionState,
  markTranscriptionCompleted,
  markTranscriptionFailed,
  type TranscriptionFailureCode,
  type TranscriptionState,
} from "./transcription-state.js";
import type { TranscriptionStore } from "./transcription-store.js";

interface MeetingTranscriptionServiceOptions {
  concurrency: number;
  convertPcmToOgg?: (inputPath: string, outputPath: string) => Promise<void>;
  interSpeechSilenceMs: number;
  logger: Logger;
  manifestStore: ManifestStore;
  notifyFailure(manifest: RecordingManifest): Promise<void>;
  publishTranscriptOnly?(manifest: RecordingManifest, transcriptPath: string): Promise<void>;
  now?: () => Date;
  provider?: TranscriptionProvider;
  resolveProvider?: (manifest: RecordingManifest) => Promise<TranscriptionProvider>;
  resolveSpeechAnalyzer?: (manifest: RecordingManifest) => Promise<SpeechAnalyzer> | SpeechAnalyzer;
  speechAnalyzer?: SpeechAnalyzer;
  transcriptionStore: TranscriptionStore;
  transcriptionMergeMaxGapMs: number;
  transcriptionWindowMaxMs: number;
  writePcmAsWav?: (inputPath: string, outputPath: string) => Promise<void>;
}

interface TranscriptionProcessingOptions {
  notifyTerminalFailure?: boolean;
}

class LanguageDetectionError extends Error {
  public constructor() {
    super("The predominant meeting language could not be determined");
    this.name = "LanguageDetectionError";
  }
}

export class MeetingTranscriptionService {
  readonly #audioPreparer: MeetingAudioPreparer;
  readonly #concurrency: number;
  readonly #interSpeechSilenceMs: number;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #notifyFailure: (manifest: RecordingManifest) => Promise<void>;
  readonly #now: () => Date;
  readonly #provider: TranscriptionProvider | undefined;
  readonly #publishTranscriptOnly:
    | ((manifest: RecordingManifest, transcriptPath: string) => Promise<void>)
    | undefined;
  readonly #resolveProvider:
    | ((manifest: RecordingManifest) => Promise<TranscriptionProvider>)
    | undefined;
  readonly #resolveSpeechAnalyzer:
    | ((manifest: RecordingManifest) => Promise<SpeechAnalyzer> | SpeechAnalyzer)
    | undefined;
  readonly #speechAnalyzer: SpeechAnalyzer | undefined;
  readonly #transcriptionStore: TranscriptionStore;
  readonly #transcriptionMergeMaxGapMs: number;
  readonly #transcriptionWindowMaxMs: number;

  public constructor(options: MeetingTranscriptionServiceOptions) {
    this.#audioPreparer = new MeetingAudioPreparer(options);
    this.#concurrency = options.concurrency;
    this.#interSpeechSilenceMs = options.interSpeechSilenceMs;
    this.#logger = options.logger;
    this.#manifestStore = options.manifestStore;
    this.#notifyFailure = options.notifyFailure;
    this.#now = options.now ?? (() => new Date());
    this.#provider = options.provider;
    this.#publishTranscriptOnly = options.publishTranscriptOnly;
    this.#resolveProvider = options.resolveProvider;
    this.#resolveSpeechAnalyzer = options.resolveSpeechAnalyzer;
    this.#speechAnalyzer = options.speechAnalyzer;
    this.#transcriptionStore = options.transcriptionStore;
    this.#transcriptionMergeMaxGapMs = options.transcriptionMergeMaxGapMs;
    this.#transcriptionWindowMaxMs = options.transcriptionWindowMaxMs;
    if (this.#provider === undefined && this.#resolveProvider === undefined) {
      throw new Error("A transcription provider or resolver is required");
    }
    if (this.#speechAnalyzer === undefined && this.#resolveSpeechAnalyzer === undefined) {
      throw new Error("A speech analyzer or resolver is required");
    }
  }

  public async process(
    manifest: RecordingManifest,
    options: TranscriptionProcessingOptions = {},
  ): Promise<void> {
    if (manifest.status !== "completed") {
      throw new Error("Somente uma gravação concluída normalmente pode ser transcrita");
    }

    let state: TranscriptionState | undefined;
    let meetingSpeechAnalyzer: SpeechAnalyzer | undefined;
    try {
      state =
        (await this.#transcriptionStore.tryLoad(manifest.meetingId)) ??
        createTranscriptionState(
          manifest.meetingId,
          manifest.segments.map((segment) => segment.segmentId),
          this.#now().toISOString(),
        );
      if (state.status === "completed" || state.status === "failed") {
        return;
      }
      let processingState = this.#restartForLanguageDetection(manifest, state);
      state = processingState;
      await this.#transcriptionStore.save(processingState);
      this.#logger.info(
        { meetingId: manifest.meetingId, segmentCount: manifest.segments.length },
        "Meeting transcription processing started",
      );
      const pending = processingState.segments.filter((segment) => segment.status === "pending");
      const provider = this.#resolveProvider
        ? await this.#resolveProvider(manifest)
        : this.#provider;
      if (provider === undefined) throw new Error("The transcription provider is unavailable");
      meetingSpeechAnalyzer = this.#resolveSpeechAnalyzer
        ? await this.#resolveSpeechAnalyzer(manifest)
        : this.#speechAnalyzer;
      if (meetingSpeechAnalyzer === undefined) {
        throw new Error("The speech analyzer is unavailable");
      }
      const speechAnalyzer = meetingSpeechAnalyzer;
      const transcriptionConfiguration = manifest.aiConfiguration?.transcription;
      const interSpeechSilenceMs =
        transcriptionConfiguration?.interSpeechSilenceMs ?? this.#interSpeechSilenceMs;
      const transcriptionMergeMaxGapMs =
        transcriptionConfiguration?.mergeMaxGapMs ?? this.#transcriptionMergeMaxGapMs;
      const prepared = await this.#audioPreparer.prepareAll(
        manifest,
        new Set(pending.map((segment) => segment.segmentId)),
      );
      const preparedBySegmentId = new Map(
        prepared.map((audio) => [audio.segment.segmentId, audio]),
      );
      const pendingIds = new Set(pending.map((segment) => segment.segmentId));
      const groups = createTranscriptionGroups(
        manifest.segments.filter((segment) => pendingIds.has(segment.segmentId)),
        {
          maxGapMs: transcriptionMergeMaxGapMs,
          maxWindowMs: this.#transcriptionWindowMaxMs,
        },
      );
      const languageEvidence: Array<LanguageEvidence & { segmentIds: readonly string[] }> = [];
      let stateQueue = Promise.resolve();
      const persistGroup: PersistTranscriptionGroup = (group, input) => {
        const persistence = stateQueue.then(async () => {
          const first = group[0];
          if (first === undefined) {
            throw new Error("O lote de transcrição está vazio");
          }
          processingState = completeTranscriptionGroup(
            processingState,
            input.batch === undefined
              ? {
                  representativeSegmentId: first.segmentId,
                  result: input.result,
                  segmentIds: group.map((segment) => segment.segmentId),
                }
              : {
                  audioDurationMs: input.batch.durationMs,
                  representativeSegmentId: input.batch.representativeSegmentId,
                  result: input.result,
                  segmentIds: input.batch.segmentIds,
                  timelineStartedAtMs: input.batch.timelineStartedAtMs,
                },
            this.#now().toISOString(),
          );
          state = processingState;
          await this.#transcriptionStore.save(processingState);
        });
        stateQueue = persistence.catch(() => undefined);
        return persistence;
      };
      try {
        await mapWithConcurrency(groups, this.#concurrency, (group) =>
          processTranscriptionGroup(group, {
            interSpeechSilenceMs,
            languageEvidence,
            logger: this.#logger,
            manifest,
            persistGroup,
            preparedBySegmentId,
            provider,
            speechAnalyzer,
            transcriptionMergeMaxGapMs,
            transcriptionWindowMaxMs: this.#transcriptionWindowMaxMs,
          }),
        );
      } finally {
        await Promise.allSettled(
          prepared.map((audio) =>
            audio.cleanup === undefined ? Promise.resolve() : audio.cleanup(),
          ),
        );
      }

      const transcribedSegments = toTranscribedSegments(processingState);
      const transcript = assembleTranscript(manifest, transcribedSegments);
      await this.#transcriptionStore.writeTranscript(manifest.meetingId, transcript);
      await this.#persistPredominantLanguage(manifest, languageEvidence);
      processingState = markTranscriptionCompleted(processingState, this.#now().toISOString());
      state = processingState;
      await this.#transcriptionStore.save(processingState);
      this.#logger.info(
        { meetingId: manifest.meetingId, segmentCount: manifest.segments.length },
        "Meeting transcription completed",
      );
    } catch (error) {
      await this.#handleFailure(manifest, state, error, options);
    } finally {
      await this.#closeMeetingSpeechAnalyzer(manifest.meetingId, meetingSpeechAnalyzer);
    }
  }

  async #handleFailure(
    manifest: RecordingManifest,
    state: TranscriptionState | undefined,
    error: unknown,
    options: TranscriptionProcessingOptions,
  ): Promise<void> {
    const failureCode = getFailureCode(error);
    await this.#persistFailure(manifest, state, error, failureCode);
    this.#logFailure(manifest.meetingId, error, failureCode);
    if (await this.#publishTranscriptAfterLanguageFailure(manifest, error)) return;
    if ((options.notifyTerminalFailure ?? true) || failureCode !== "provider_failed") {
      await this.#notifyTranscriptionFailure(manifest);
    }
  }

  async #persistPredominantLanguage(
    manifest: RecordingManifest,
    evidence: readonly (LanguageEvidence & { segmentIds: readonly string[] })[],
  ): Promise<void> {
    if (manifest.aiConfiguration === undefined || manifest.predominantLanguage !== undefined)
      return;
    const configuredLanguage = manifest.aiConfiguration.transcription.language;
    if (configuredLanguage !== "auto") {
      await this.#manifestStore.save(
        setPredominantLanguage(manifest, normalizeDetectedLanguage(configuredLanguage)),
      );
      return;
    }
    let language: PredominantLanguageResult;
    try {
      language = aggregatePredominantLanguage(evidence);
    } catch {
      throw new LanguageDetectionError();
    }
    await this.#manifestStore.save(setPredominantLanguage(manifest, language.language));
    this.#logger.info(
      {
        confidence: language.confidence,
        distribution: language.distribution,
        evidenceSegmentIds: evidence.flatMap((item) => item.segmentIds),
        meetingId: manifest.meetingId,
        predominantLanguage: language.language,
      },
      "Meeting predominant language identified",
    );
  }

  #restartForLanguageDetection(
    manifest: RecordingManifest,
    state: TranscriptionState,
  ): TranscriptionState {
    const shouldRestart =
      manifest.aiConfiguration !== undefined &&
      manifest.aiConfiguration.transcription.language === "auto" &&
      manifest.predominantLanguage === undefined &&
      state.status === "processing" &&
      state.segments.some((segment) => segment.status === "completed");
    if (!shouldRestart) return state;
    this.#logger.info(
      { meetingId: manifest.meetingId },
      "Transcription restarted to determine language from all audio batches",
    );
    return createTranscriptionState(
      manifest.meetingId,
      manifest.segments.map((segment) => segment.segmentId),
      this.#now().toISOString(),
    );
  }

  async #persistFailure(
    manifest: RecordingManifest,
    state: TranscriptionState | undefined,
    error: unknown,
    failureCode: TranscriptionFailureCode,
  ): Promise<void> {
    try {
      if (!(error instanceof LanguageDetectionError)) {
        await this.#transcriptionStore.removeTranscript(manifest.meetingId);
      }
      const failureState =
        state ??
        createTranscriptionState(
          manifest.meetingId,
          manifest.segments.map((segment) => segment.segmentId),
          this.#now().toISOString(),
        );
      await this.#transcriptionStore.save(
        markTranscriptionFailed(
          failureState,
          failureCode,
          this.#now().toISOString(),
          getTranscriptionRecoveryReason(error),
        ),
      );
    } catch (storageError) {
      this.#logger.error(
        { errorType: getErrorType(storageError), meetingId: manifest.meetingId },
        "Failed to persist lost transcription state",
      );
    }
  }

  #logFailure(meetingId: string, error: unknown, failureCode: TranscriptionFailureCode): void {
    const incompatibilityReason =
      error instanceof IncompatibleTranscriptionResponseError ? error.reason : undefined;
    this.#logger.error(
      {
        errorType: getErrorType(error),
        failureCode,
        ...(incompatibilityReason === undefined ? {} : { incompatibilityReason }),
        meetingId,
      },
      "Meeting transcription failed",
    );
  }

  async #publishTranscriptAfterLanguageFailure(
    manifest: RecordingManifest,
    error: unknown,
  ): Promise<boolean> {
    if (!(error instanceof LanguageDetectionError) || this.#publishTranscriptOnly === undefined) {
      return false;
    }
    try {
      await this.#publishTranscriptOnly(
        manifest,
        this.#transcriptionStore.transcriptPath(manifest.meetingId),
      );
    } catch (publicationError) {
      this.#logger.error(
        { errorType: getErrorType(publicationError), meetingId: manifest.meetingId },
        "Unable to publish transcript after language detection failure",
      );
    }
    return true;
  }

  async #notifyTranscriptionFailure(manifest: RecordingManifest): Promise<void> {
    try {
      await this.#notifyFailure(manifest);
    } catch (notificationError) {
      this.#logger.warn(
        { errorType: getErrorType(notificationError), meetingId: manifest.meetingId },
        "Unable to notify transcription failure",
      );
    }
  }

  async #closeMeetingSpeechAnalyzer(
    meetingId: string,
    speechAnalyzer: SpeechAnalyzer | undefined,
  ): Promise<void> {
    if (this.#resolveSpeechAnalyzer === undefined || speechAnalyzer === undefined) return;
    await speechAnalyzer.close().catch((error: unknown) => {
      this.#logger.warn(
        { errorType: getErrorType(error), meetingId },
        "Unable to close meeting speech analyzer",
      );
    });
  }
}

function toTranscribedSegments(state: TranscriptionState): TranscribedSegment[] {
  return state.segments.map((segment) => {
    if (segment.status !== "completed") {
      throw new Error("A transcrição ainda possui segmentos pendentes");
    }
    return {
      ...(segment.audioDurationMs === undefined
        ? {}
        : { audioDurationMs: segment.audioDurationMs }),
      pieces: segment.pieces,
      segmentId: segment.segmentId,
      words: segment.words,
      ...(segment.timelineStartedAtMs === undefined
        ? {}
        : { timelineStartedAtMs: segment.timelineStartedAtMs }),
    };
  });
}

function getFailureCode(error: unknown): TranscriptionFailureCode {
  if (error instanceof AudioAnalysisError) {
    return "audio_analysis_failed";
  }
  if (error instanceof AudioPreparationError) {
    return "audio_conversion_failed";
  }
  if (error instanceof LanguageDetectionError) {
    return "language_detection_failed";
  }
  return isStorageError(error) ? "storage_failed" : "provider_failed";
}

function getTranscriptionRecoveryReason(error: unknown): TranscriptionRecoveryReason | undefined {
  if (!(error instanceof IncompatibleTranscriptionResponseError)) return undefined;
  return error.reason === "invalid_audio_duration" ? undefined : error.reason;
}

function isStorageError(error: unknown): boolean {
  return (
    error instanceof SyntaxError ||
    (error instanceof Error &&
      (error.name === "ZodError" || ("code" in error && typeof error.code === "string")))
  );
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
