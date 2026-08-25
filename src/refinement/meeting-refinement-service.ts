import type { Logger } from "pino";

import type { RecordingManifest } from "../recording/manifest.js";
import {
  assembleTranscriptEntries,
  assembleTranscriptFromEntries,
} from "../transcription/transcript-assembler.js";
import type { TranscribedSegment } from "../transcription/transcription-provider.js";
import type { TranscriptionState } from "../transcription/transcription-state.js";
import type { TranscriptionStore } from "../transcription/transcription-store.js";
import type { MeetingRefinementGenerationResult } from "./meeting-refinement-generator.js";
import { RefinementProviderFailureError } from "./openrouter-refinement-provider.js";
import {
  createRefinementState,
  markRefinementCompleted,
  markRefinementFallback,
} from "./refinement-state.js";
import type { RefinementStore } from "./refinement-store.js";
import type { RefinementEntry } from "./refinement-result.js";

export interface RefinementGenerator {
  generate(entries: readonly RefinementEntry[]): Promise<MeetingRefinementGenerationResult>;
}

interface MeetingRefinementServiceOptions {
  generator: RefinementGenerator;
  logger: Logger;
  now?: () => Date;
  refinementStore: RefinementStore;
  transcriptionStore: TranscriptionStore;
}

interface RefinementProcessingOptions {
  fallbackOnProviderFailure?: boolean;
}

export class MeetingRefinementService {
  readonly #generator: RefinementGenerator;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #refinementStore: RefinementStore;
  readonly #transcriptionStore: TranscriptionStore;

  public constructor(options: MeetingRefinementServiceOptions) {
    this.#generator = options.generator;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#refinementStore = options.refinementStore;
    this.#transcriptionStore = options.transcriptionStore;
  }

  public async process(
    manifest: RecordingManifest,
    options: RefinementProcessingOptions = {},
  ): Promise<void> {
    if (manifest.status !== "completed") {
      throw new Error("Somente uma gravação concluída pode ter a transcrição refinada");
    }
    const transcription = await this.#transcriptionStore.tryLoad(manifest.meetingId);
    if (transcription?.status !== "completed") return;

    let state = await this.#refinementStore.tryLoad(manifest.meetingId);
    if (state?.status === "completed" || state?.status === "fallback") {
      return;
    }

    const entries = assembleTranscriptEntries(manifest, toTranscribedSegments(transcription));
    const rawTranscript = await this.#transcriptionStore.preserveRawTranscript(manifest.meetingId);
    state ??= createRefinementState(manifest.meetingId, this.#now().toISOString());
    await this.#refinementStore.save(state);
    this.#logger.info({ meetingId: manifest.meetingId }, "Refinamento da transcrição iniciado");

    let generated: MeetingRefinementGenerationResult;
    try {
      generated = await this.#generator.generate(entries);
    } catch (error) {
      if (!(error instanceof RefinementProviderFailureError)) throw error;
      await this.#transcriptionStore.writeTranscript(manifest.meetingId, rawTranscript);
      if (!(options.fallbackOnProviderFailure ?? true)) {
        throw error;
      }
      const fallback = markRefinementFallback(
        state,
        entries,
        error.attempts,
        this.#now().toISOString(),
      );
      await this.#refinementStore.save(fallback);
      this.#logger.error(
        { attempts: error.attempts, errorType: error.name, meetingId: manifest.meetingId },
        "Refinamento indisponível; a transcrição original será utilizada",
      );
      return;
    }

    await this.#transcriptionStore.writeTranscript(
      manifest.meetingId,
      assembleTranscriptFromEntries(generated.entries),
    );
    const completed = markRefinementCompleted(
      state,
      generated.entries,
      generated.attempts,
      this.#now().toISOString(),
    );
    await this.#refinementStore.save(completed);
    this.#logger.info(
      { attempts: generated.attempts, meetingId: manifest.meetingId },
      "Refinamento da transcrição concluído",
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
