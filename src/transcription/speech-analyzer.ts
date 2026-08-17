import { spawn } from "node:child_process";

import { RealTimeVAD } from "avr-vad";
import ffmpegPath from "ffmpeg-static";

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
  threshold: number,
  minimumSpeechFrames: number,
) => Promise<VadSession>;
type DecodeAudio = (path: string) => Promise<Float32Array>;

interface SileroSpeechAnalyzerOptions {
  createVad?: CreateVad;
  decodeAudio?: DecodeAudio;
  maxDurationSeconds?: number;
  minSpeechDurationMs: number;
  threshold: number;
}

export class SileroSpeechAnalyzer implements SpeechAnalyzer {
  readonly #createVad: CreateVad;
  readonly #decodeAudio: DecodeAudio;
  readonly #minimumSpeechFrames: number;
  readonly #threshold: number;
  #closed = false;
  #currentSampleCount = 0;
  #processedSamples = 0;
  #queue = Promise.resolve();
  #vad: Promise<VadSession> | undefined;
  #speechRanges: SpeechRange[] = [];

  public constructor(options: SileroSpeechAnalyzerOptions) {
    this.#createVad = options.createVad ?? createSileroVad;
    const maximumBytes =
      ((options.maxDurationSeconds ?? 3_600) + 1) *
      TRANSCRIPTION_SAMPLE_RATE *
      Float32Array.BYTES_PER_ELEMENT;
    this.#decodeAudio =
      options.decodeAudio ?? ((path) => decodeAudioFile(path, Math.ceil(maximumBytes)));
    this.#minimumSpeechFrames = Math.ceil(options.minSpeechDurationMs / 32);
    this.#threshold = options.threshold;
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
      this.#threshold,
      this.#minimumSpeechFrames,
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
  threshold: number,
  minimumSpeechFrames: number,
): Promise<VadSession> {
  return RealTimeVAD.new({
    model: "v5",
    minSpeechFrames: minimumSpeechFrames,
    negativeSpeechThreshold: Math.max(0, threshold - 0.15),
    onFrameProcessed: (_probabilities, frame) => callbacks.onFrameProcessed(frame),
    onSpeechEnd: (audio) => callbacks.onSpeechEnd(audio),
    positiveSpeechThreshold: threshold,
    sampleRate: TRANSCRIPTION_SAMPLE_RATE,
  });
}

async function decodeAudioFile(path: string, maximumBytes: number): Promise<Float32Array> {
  // O pacote é CommonJS e o TypeScript 7 interpreta incorretamente o default no modo NodeNext.
  const executablePath = ffmpegPath as unknown as string | null;
  if (executablePath === null) {
    throw new Error("O binário do FFmpeg não está disponível");
  }

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
