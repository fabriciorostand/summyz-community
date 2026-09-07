import { rm } from "node:fs/promises";

import type { Logger } from "pino";

import { convertPcmToOgg as defaultConvertPcmToOgg } from "../recording/audio-converter.js";
import type { RecordingManifest, RecordingSegment } from "../recording/manifest.js";
import type { ManifestStore } from "../recording/manifest-store.js";
import type { TranscriptionStore } from "./transcription-store.js";
import { writePcmAsWav as defaultWritePcmAsWav } from "./wav.js";

export interface PreparedAudio {
  cleanup?: () => Promise<void>;
  path: string;
  segment: RecordingSegment;
}

export class AudioPreparationError extends Error {
  public constructor() {
    super("Não foi possível preparar todos os segmentos de áudio");
    this.name = "AudioPreparationError";
  }
}

interface MeetingAudioPreparerOptions {
  convertPcmToOgg?: (inputPath: string, outputPath: string) => Promise<void>;
  logger: Logger;
  manifestStore: ManifestStore;
  transcriptionStore: TranscriptionStore;
  writePcmAsWav?: (inputPath: string, outputPath: string) => Promise<void>;
}

export class MeetingAudioPreparer {
  readonly #convertPcmToOgg: (inputPath: string, outputPath: string) => Promise<void>;
  readonly #logger: Logger;
  readonly #manifestStore: ManifestStore;
  readonly #transcriptionStore: TranscriptionStore;
  readonly #writePcmAsWav: (inputPath: string, outputPath: string) => Promise<void>;

  public constructor(options: MeetingAudioPreparerOptions) {
    this.#convertPcmToOgg = options.convertPcmToOgg ?? defaultConvertPcmToOgg;
    this.#logger = options.logger;
    this.#manifestStore = options.manifestStore;
    this.#transcriptionStore = options.transcriptionStore;
    this.#writePcmAsWav = options.writePcmAsWav ?? defaultWritePcmAsWav;
  }

  public async prepareAll(
    manifest: RecordingManifest,
    pendingSegmentIds: ReadonlySet<string>,
  ): Promise<PreparedAudio[]> {
    const prepared: PreparedAudio[] = [];
    try {
      for (const segment of manifest.segments) {
        if (pendingSegmentIds.has(segment.segmentId)) {
          prepared.push(await this.#prepare(manifest, segment));
        }
      }
      return prepared;
    } catch (error) {
      await cleanupPreparedAudio(prepared);
      if (error instanceof AudioPreparationError) throw error;
      throw new AudioPreparationError();
    }
  }

  async #prepare(manifest: RecordingManifest, segment: RecordingSegment): Promise<PreparedAudio> {
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
    const converted = await this.#tryOggConversion(manifest, segment, pcmPath, paths.finalPath);
    if (converted !== undefined) return converted;
    return this.#writeWavFallback(manifest, segment, pcmPath);
  }

  async #tryOggConversion(
    manifest: RecordingManifest,
    segment: RecordingSegment,
    pcmPath: string,
    finalPath: string,
  ): Promise<PreparedAudio | undefined> {
    try {
      await this.#convertPcmToOgg(pcmPath, finalPath);
      return { cleanup: () => rm(finalPath, { force: true }), path: finalPath, segment };
    } catch (error) {
      await rm(finalPath, { force: true });
      this.#logger.warn(
        {
          errorType: getErrorType(error),
          meetingId: manifest.meetingId,
          segmentId: segment.segmentId,
        },
        "Ogg conversion retry failed; using WAV fallback",
      );
      return undefined;
    }
  }

  async #writeWavFallback(
    manifest: RecordingManifest,
    segment: RecordingSegment,
    pcmPath: string,
  ): Promise<PreparedAudio> {
    const wavPath = this.#transcriptionStore.resolveMeetingFile(
      manifest.meetingId,
      `participants/${segment.userId}/${segment.segmentId}.wav`,
    );
    await rm(wavPath, { force: true });
    try {
      await this.#writePcmAsWav(pcmPath, wavPath);
      return { cleanup: () => rm(wavPath, { force: true }), path: wavPath, segment };
    } catch {
      await rm(wavPath, { force: true });
      throw new AudioPreparationError();
    }
  }
}

async function cleanupPreparedAudio(prepared: readonly PreparedAudio[]): Promise<void> {
  await Promise.allSettled(
    prepared.map((audio) => (audio.cleanup === undefined ? Promise.resolve() : audio.cleanup())),
  );
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
