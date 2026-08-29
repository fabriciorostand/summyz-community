import { rm } from "node:fs/promises";

import type { Logger } from "pino";

import { convertPcmToOgg as defaultConvertPcmToOgg } from "../recording/audio-converter.js";
import type { RecordingManifest, RecordingSegment } from "../recording/manifest.js";
import type { ManifestStore } from "../recording/manifest-store.js";
import { mapWithConcurrency } from "./concurrency.js";
import type { SpeechAnalyzer } from "./speech-analyzer.js";
import {
  composeTranscriptionBatch,
  createAnalyzedTranscriptionGroups,
  createTranscriptionGroups,
  mapTranscriptPiecesToTimeline,
} from "./transcription-batch.js";
import type { TranscriptionBatch } from "./transcription-batch.js";
import { assembleTranscript } from "./transcript-assembler.js";
import {
  completeTranscriptionGroup,
  createTranscriptionState,
  markTranscriptionCompleted,
  markTranscriptionFailed,
  type TranscriptionFailureCode,
  type TranscriptionState,
} from "./transcription-state.js";
import type { TranscriptionStore } from "./transcription-store.js";
import { IncompatibleTranscriptionResponseError } from "./transcription-provider.js";
import type { TranscribedSegment, TranscriptionProvider } from "./transcription-provider.js";
import { writePcmAsWav as defaultWritePcmAsWav } from "./wav.js";

interface PreparedAudio {
  cleanup?: () => Promise<void>;
  path: string;
  segment: RecordingSegment;
}

interface MeetingTranscriptionServiceOptions {
  concurrency: number;
  convertPcmToOgg?: (inputPath: string, outputPath: string) => Promise<void>;
  interSpeechSilenceMs: number;
  logger: Logger;
  manifestStore: ManifestStore;
  notifyFailure(manifest: RecordingManifest): Promise<void>;
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

class AudioPreparationError extends Error {
  public constructor() {
    super("Não foi possível preparar todos os segmentos de áudio");
    this.name = "AudioPreparationError";
  }
}

class AudioAnalysisError extends Error {
  public constructor() {
    super("Não foi possível analisar a presença de voz no áudio");
    this.name = "AudioAnalysisError";
  }
}

export class MeetingTranscriptionService {
  readonly #concurrency: number;
  readonly #convertPcmToOgg: (inputPath: string, outputPath: string) => Promise<void>;
  readonly #interSpeechSilenceMs: number;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #notifyFailure: (manifest: RecordingManifest) => Promise<void>;
  readonly #now: () => Date;
  readonly #provider: TranscriptionProvider | undefined;
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
  readonly #writePcmAsWav: (inputPath: string, outputPath: string) => Promise<void>;

  public constructor(options: MeetingTranscriptionServiceOptions) {
    this.#concurrency = options.concurrency;
    this.#convertPcmToOgg = options.convertPcmToOgg ?? defaultConvertPcmToOgg;
    this.#interSpeechSilenceMs = options.interSpeechSilenceMs;
    this.#logger = options.logger;
    this.#manifestStore = options.manifestStore;
    this.#notifyFailure = options.notifyFailure;
    this.#now = options.now ?? (() => new Date());
    this.#provider = options.provider;
    this.#resolveProvider = options.resolveProvider;
    this.#resolveSpeechAnalyzer = options.resolveSpeechAnalyzer;
    this.#speechAnalyzer = options.speechAnalyzer;
    this.#transcriptionStore = options.transcriptionStore;
    this.#transcriptionMergeMaxGapMs = options.transcriptionMergeMaxGapMs;
    this.#transcriptionWindowMaxMs = options.transcriptionWindowMaxMs;
    this.#writePcmAsWav = options.writePcmAsWav ?? defaultWritePcmAsWav;
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
      let processingState = state;
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
      const prepared = await this.#prepareAllAudio(
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
      let stateQueue = Promise.resolve();
      const persistGroup = (
        group: readonly RecordingSegment[],
        input:
          | {
              batch: TranscriptionBatch;
              result: Awaited<ReturnType<TranscriptionProvider["transcribe"]>>;
            }
          | { batch: undefined; result: { attempts: 0; pieces: [] } },
      ): Promise<void> => {
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
        await mapWithConcurrency(groups, this.#concurrency, async (group) => {
          const audioFiles = group.map((segment) => {
            const audio = preparedBySegmentId.get(segment.segmentId);
            if (audio === undefined) {
              throw new Error("O áudio do segmento não foi preparado");
            }
            return audio;
          });
          const analyzed = [];
          for (const audio of audioFiles) {
            try {
              const analysis = await speechAnalyzer.analyze(audio.path);
              analyzed.push({ ...analysis, segment: audio.segment });
            } catch {
              throw new AudioAnalysisError();
            }
          }
          const silentSegments = analyzed
            .filter((item) => !item.containsSpeech)
            .map((item) => item.segment);
          if (silentSegments.length > 0) {
            await persistGroup(silentSegments, {
              batch: undefined,
              result: { attempts: 0, pieces: [] },
            });
            this.#logger.info(
              { meetingId: manifest.meetingId, segmentCount: silentSegments.length },
              "Segments without speech discarded from transcription",
            );
          }
          const speechGroups = createAnalyzedTranscriptionGroups(analyzed, {
            maxGapMs: transcriptionMergeMaxGapMs,
            maxWindowMs: this.#transcriptionWindowMaxMs,
          });
          for (const speechGroup of speechGroups) {
            const batch = composeTranscriptionBatch(speechGroup, undefined, interSpeechSilenceMs);
            if (batch === undefined) {
              throw new AudioAnalysisError();
            }
            const result = await provider.transcribe({
              audio: batch.audio,
              audioDurationMs: batch.audioDurationMs,
              format: "wav",
              ...(manifest.aiConfiguration === undefined
                ? {}
                : { language: manifest.aiConfiguration.transcription.language }),
            });
            await persistGroup(
              speechGroup.map((item) => item.segment),
              {
                batch,
                result: { ...result, pieces: mapTranscriptPiecesToTimeline(batch, result.pieces) },
              },
            );
            this.#logger.info(
              {
                attempts: result.attempts,
                meetingId: manifest.meetingId,
                segmentCount: speechGroup.length,
              },
              "Audio batch transcribed",
            );
          }
        });
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
      processingState = markTranscriptionCompleted(processingState, this.#now().toISOString());
      state = processingState;
      await this.#transcriptionStore.save(processingState);
      this.#logger.info(
        { meetingId: manifest.meetingId, segmentCount: manifest.segments.length },
        "Meeting transcription completed",
      );
    } catch (error) {
      const failureCode = getFailureCode(error);
      try {
        await this.#transcriptionStore.removeTranscript(manifest.meetingId);
        const failureState =
          state ??
          createTranscriptionState(
            manifest.meetingId,
            manifest.segments.map((segment) => segment.segmentId),
            this.#now().toISOString(),
          );
        state = markTranscriptionFailed(failureState, failureCode, this.#now().toISOString());
        await this.#transcriptionStore.save(state);
      } catch (storageError) {
        this.#logger.error(
          { errorType: getErrorType(storageError), meetingId: manifest.meetingId },
          "Failed to persist lost transcription state",
        );
      }
      const incompatibilityReason =
        error instanceof IncompatibleTranscriptionResponseError ? error.reason : undefined;
      this.#logger.error(
        {
          errorType: getErrorType(error),
          failureCode,
          ...(incompatibilityReason === undefined ? {} : { incompatibilityReason }),
          meetingId: manifest.meetingId,
        },
        "Meeting transcription failed",
      );
      if ((options.notifyTerminalFailure ?? true) || failureCode !== "provider_failed") {
        try {
          await this.#notifyFailure(manifest);
        } catch (notificationError) {
          this.#logger.warn(
            { errorType: getErrorType(notificationError), meetingId: manifest.meetingId },
            "Unable to notify transcription failure",
          );
        }
      }
    } finally {
      if (this.#resolveSpeechAnalyzer !== undefined && meetingSpeechAnalyzer !== undefined) {
        await meetingSpeechAnalyzer.close().catch((error: unknown) => {
          this.#logger.warn(
            { errorType: getErrorType(error), meetingId: manifest.meetingId },
            "Unable to close meeting speech analyzer",
          );
        });
      }
    }
  }

  async #prepareAllAudio(
    manifest: RecordingManifest,
    pendingSegmentIds: ReadonlySet<string>,
  ): Promise<PreparedAudio[]> {
    const prepared: PreparedAudio[] = [];
    try {
      for (const segment of manifest.segments) {
        if (pendingSegmentIds.has(segment.segmentId)) {
          prepared.push(await this.#prepareAudio(manifest, segment));
        }
      }
      return prepared;
    } catch (error) {
      await Promise.allSettled(
        prepared.map((audio) =>
          audio.cleanup === undefined ? Promise.resolve() : audio.cleanup(),
        ),
      );
      if (error instanceof AudioPreparationError) {
        throw error;
      }
      throw new AudioPreparationError();
    }
  }

  async #prepareAudio(
    manifest: RecordingManifest,
    segment: RecordingSegment,
  ): Promise<PreparedAudio> {
    if (segment.status === "ready" && segment.format === "ogg_opus") {
      return {
        path: this.#transcriptionStore.resolveMeetingFile(manifest.meetingId, segment.file),
        segment,
      };
    }
    if (segment.status !== "conversion_failed" || segment.format !== "pcm_s16le") {
      throw new AudioPreparationError();
    }

    const pcmPath = this.#transcriptionStore.resolveMeetingFile(manifest.meetingId, segment.file);
    const paths = this.#manifestStore.segmentPaths(
      manifest.meetingId,
      segment.userId,
      segment.segmentId,
    );
    try {
      await this.#convertPcmToOgg(pcmPath, paths.finalPath);
      return {
        cleanup: () => rm(paths.finalPath, { force: true }),
        path: paths.finalPath,
        segment,
      };
    } catch (error) {
      await rm(paths.finalPath, { force: true });
      this.#logger.warn(
        {
          errorType: getErrorType(error),
          meetingId: manifest.meetingId,
          segmentId: segment.segmentId,
        },
        "Ogg conversion retry failed; using WAV fallback",
      );
    }

    const wavPath = this.#transcriptionStore.resolveMeetingFile(
      manifest.meetingId,
      `participants/${segment.userId}/${segment.segmentId}.wav`,
    );
    await rm(wavPath, { force: true });
    try {
      await this.#writePcmAsWav(pcmPath, wavPath);
      return {
        cleanup: () => rm(wavPath, { force: true }),
        path: wavPath,
        segment,
      };
    } catch {
      await rm(wavPath, { force: true });
      throw new AudioPreparationError();
    }
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
  return isStorageError(error) ? "storage_failed" : "provider_failed";
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
