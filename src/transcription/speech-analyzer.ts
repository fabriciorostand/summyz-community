import { spawn } from "node:child_process";

import { RealTimeVAD } from "avr-vad";

import { resolveFfmpegExecutable } from "../media/ffmpeg-executable.js";
import { TRANSCRIPTION_SAMPLE_RATE } from "./transcription-batch.js";

export interface SpeechAnalysis {
  containsSpeech: boolean;
  samples: Float32Array;
  speechRanges: SpeechRange[];
}

export interface SpeechRange {
  endedAtSample: number;
  startedAtSample: number;
}

export interface SpeechAnalyzer {
  analyze(path: string): Promise<SpeechAnalysis>;
  close(): Promise<void>;
}

export interface VadSession {
  destroy(): Promise<void>;
  flush(): Promise<void>;
  pause(): void;
  processAudio(samples: Float32Array): Promise<void>;
  start(): void;
}

export interface VadCallbacks {
  onFrameProcessed(frame: Float32Array): void;
  onSpeechEnd(audio: Float32Array): void;
}

type CreateVad = (
  callbacks: VadCallbacks,
  configuration: SileroVadConfiguration,
) => Promise<VadSession>;
export type AudioDecoder = (path: string) => Promise<Float32Array>;

interface SileroVadConfiguration {
  minSilenceFrames: number;
  minimumSpeechFrames: number;
  negativeSpeechThreshold: number;
  preSpeechPadFrames: number;
  threshold: number;
}

interface SileroSpeechAnalyzerOptions {
  createVad?: CreateVad;
  decodeAudio?: AudioDecoder;
  maxDurationSeconds?: number;
  minSilenceDurationMs?: number;
  minSpeechDurationMs: number;
  negativeSpeechThreshold?: number;
  speechPadMs?: number;
  threshold: number;
}

export class FullAudioSpeechAnalyzer implements SpeechAnalyzer {
  readonly #decodeAudio: AudioDecoder;

  public constructor(options: { decodeAudio: AudioDecoder }) {
    this.#decodeAudio = options.decodeAudio;
  }

  public async analyze(path: string): Promise<SpeechAnalysis> {
    const samples = await this.#decodeAudio(path);
    return {
      containsSpeech: samples.length > 0,
      samples,
      speechRanges:
        samples.length === 0 ? [] : [{ endedAtSample: samples.length, startedAtSample: 0 }],
    };
  }

  public async close(): Promise<void> {
    return Promise.resolve();
  }
}

export function createAudioDecoder(maxDurationSeconds: number): AudioDecoder {
  const maximumBytes =
    (maxDurationSeconds + 1) * TRANSCRIPTION_SAMPLE_RATE * Float32Array.BYTES_PER_ELEMENT;
  return (path) => decodeAudioFile(path, Math.ceil(maximumBytes));
}

export class SileroSpeechAnalyzer implements SpeechAnalyzer {
  readonly #createVad: CreateVad;
  readonly #decodeAudio: AudioDecoder;
  readonly #vadConfiguration: SileroVadConfiguration;
  #closed = false;
  #currentSampleCount = 0;
  #processedSamples = 0;
  #queue = Promise.resolve();
  #vad: Promise<VadSession> | undefined;
  #speechRanges: SpeechRange[] = [];

  public constructor(options: SileroSpeechAnalyzerOptions) {
    this.#createVad = options.createVad ?? createSileroVad;
    this.#decodeAudio =
      options.decodeAudio ?? createAudioDecoder(options.maxDurationSeconds ?? 3_600);
    this.#vadConfiguration = {
      minSilenceFrames: Math.ceil((options.minSilenceDurationMs ?? 768) / 32),
      minimumSpeechFrames: Math.ceil(options.minSpeechDurationMs / 32),
      negativeSpeechThreshold:
        options.negativeSpeechThreshold ?? Math.max(0, options.threshold - 0.15),
      preSpeechPadFrames: Math.ceil((options.speechPadMs ?? 96) / 32),
      threshold: options.threshold,
    };
  }

  public async analyze(path: string): Promise<SpeechAnalysis> {
    return this.#runExclusive(async () => {
      if (this.#closed) {
        throw new Error("O analisador de voz já foi encerrado");
      }
      const samples = await this.#decodeAudio(path);
      const vad = await this.#getVad();
      this.#currentSampleCount = samples.length;
      this.#processedSamples = 0;
      this.#speechRanges = [];
      vad.start();
      try {
        await vad.processAudio(samples);
        await vad.flush();
        return {
          containsSpeech: this.#speechRanges.length > 0,
          samples,
          speechRanges: [...this.#speechRanges],
        };
      } finally {
        vad.pause();
      }
    });
  }

  public async close(): Promise<void> {
    await this.#runExclusive(async () => {
      if (this.#closed) {
        return;
      }
      this.#closed = true;
      if (this.#vad !== undefined) {
        await (await this.#vad).destroy();
      }
    });
  }

  async #getVad(): Promise<VadSession> {
    this.#vad ??= this.#createVad(
      {
        onFrameProcessed: (frame) => {
          this.#processedSamples += frame.length;
        },
        onSpeechEnd: (audio) => {
          const endedAtSample = Math.min(this.#processedSamples, this.#currentSampleCount);
          const startedAtSample = Math.max(0, endedAtSample - audio.length);
          if (endedAtSample > startedAtSample) {
            const previous = this.#speechRanges.at(-1);
            if (previous !== undefined && startedAtSample <= previous.endedAtSample) {
              previous.endedAtSample = Math.max(previous.endedAtSample, endedAtSample);
            } else {
              this.#speechRanges.push({ endedAtSample, startedAtSample });
            }
          }
        },
      },
      this.#vadConfiguration,
    );
    return this.#vad;
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

async function createSileroVad(
  callbacks: VadCallbacks,
  configuration: SileroVadConfiguration,
): Promise<VadSession> {
  return RealTimeVAD.new({
    model: "v5",
    minSpeechFrames: configuration.minimumSpeechFrames,
    negativeSpeechThreshold: configuration.negativeSpeechThreshold,
    onFrameProcessed: (_probabilities, frame) => callbacks.onFrameProcessed(frame),
    onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
    positiveSpeechThreshold: configuration.threshold,
    preSpeechPadFrames: configuration.preSpeechPadFrames,
    redemptionFrames: configuration.minSilenceFrames,
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
  });
}

async function decodeAudioFile(path: string, maximumBytes: number): Promise<Float32Array> {
  const executablePath = resolveFfmpegExecutable();

  const chunks: Buffer[] = [];
  let byteLength = 0;
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const process_ = spawn(
      executablePath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vn",
        "-f",
        "f32le",
        "-ac",
        "1",
        "-ar",
        String(TRANSCRIPTION_SAMPLE_RATE),
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let settled = false;
    let errorOutput = "";
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    process_.stdout.on("data", (chunk: Buffer) => {
      if (settled) {
        return;
      }
      byteLength += chunk.length;
      if (byteLength > maximumBytes) {
        process_.kill();
        fail(new Error("O áudio decodificado excedeu o limite configurado"));
        return;
      }
      chunks.push(chunk);
    });
    process_.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 4_000) {
        errorOutput += chunk.toString("utf8");
      }
    });
    process_.once("error", (error) => fail(error));
    process_.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(chunks, byteLength));
      } else {
        reject(new Error(`FFmpeg não decodificou o áudio: ${errorOutput.slice(0, 1_000)}`));
      }
    });
  });

  if (bytes.length % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("O FFmpeg retornou amostras de áudio incompletas");
  }
  const aligned = Uint8Array.from(bytes).buffer;
  return new Float32Array(aligned);
}
