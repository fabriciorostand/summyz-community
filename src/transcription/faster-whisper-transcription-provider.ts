import { z } from "zod";

import { localVadSchema } from "../ai-profile.js";
import type { ProviderCostRecorder } from "../cost/provider-cost-recorder.js";

import {
  IncompatibleTranscriptionResponseError,
  type TranscriptPiece,
  type TranscriptionProvider,
  type TranscriptionProviderResult,
  TranscriptionRequestError,
} from "./transcription-provider.js";

const responseSchema = z.object({
  language: z.string().min(2).max(64).optional(),
  languageProbability: z.number().min(0).max(1).optional(),
  text: z.string(),
  words: z
    .array(
      z.object({
        end: z.number().nonnegative(),
        start: z.number().nonnegative(),
        word: z.string().min(1),
      }),
    )
    .optional(),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export interface FasterWhisperTranscriptionProviderOptions {
  batchSize?: number;
  baseUrl?: string;
  costRecorder?: ProviderCostRecorder;
  device?: "auto" | "cpu" | "gpu";
  fallback?: "cpu" | "none";
  fetch?: Fetch;
  language: string;
  model: string;
  prompt?: string | null;
  timeoutMs: number;
  vad?: z.input<typeof localVadSchema>;
}

export class FasterWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly #batchSize: number;
  readonly #baseUrl: string;
  readonly #costRecorder: ProviderCostRecorder | undefined;
  readonly #device: "auto" | "cpu" | "gpu";
  readonly #fallback: "cpu" | "none";
  readonly #fetch: Fetch;
  readonly #language: string;
  readonly #model: string;
  readonly #prompt: string | null;
  readonly #timeoutMs: number;
  readonly #vad: z.infer<typeof localVadSchema>;

  public constructor(options: FasterWhisperTranscriptionProviderOptions) {
    const resolved = resolveOptions(options);
    this.#batchSize = resolved.batchSize;
    this.#baseUrl = resolved.baseUrl;
    this.#costRecorder = options.costRecorder;
    this.#device = resolved.device;
    this.#fallback = resolved.fallback;
    this.#fetch = resolved.fetch;
    this.#language = options.language;
    this.#model = options.model;
    this.#prompt = resolved.prompt;
    this.#timeoutMs = options.timeoutMs;
    this.#vad = resolved.vad;
  }

  public async transcribe(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
  ): Promise<TranscriptionProviderResult> {
    const costAttempt = await this.#costRecorder?.beginLocal("faster-whisper", this.#model);
    let result: TranscriptionProviderResult;
    try {
      result = await this.#transcribe(input);
    } catch (error) {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishLocal(costAttempt, "failure");
      }
      throw error;
    }
    if (costAttempt !== undefined) {
      await this.#costRecorder?.finishLocal(costAttempt, "success");
    }
    return result;
  }

  async #transcribe(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
  ): Promise<TranscriptionProviderResult> {
    const response = await this.#request(this.#createForm(input));
    const parsed = await parseResponse(response);
    return createTranscriptionResult(parsed, input.language ?? this.#language);
  }

  #createForm(input: Parameters<TranscriptionProvider["transcribe"]>[0]): FormData {
    const form = new FormData();
    const audioBuffer = new ArrayBuffer(input.audio.byteLength);
    new Uint8Array(audioBuffer).set(input.audio);
    form.set("audio", new Blob([audioBuffer]), `audio.${input.format}`);
    form.set("language", input.language ?? this.#language);
    form.set("model", this.#model);
    form.set("device", this.#device);
    form.set("fallback", this.#fallback);
    form.set("batchSize", String(this.#batchSize));
    form.set("vadOptions", JSON.stringify(this.#vad));
    if (this.#prompt !== null) form.set("prompt", this.#prompt);
    return form;
  }

  async #request(form: FormData): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/transcribe`, {
        body: form,
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new TranscriptionRequestError({ retryable: true });
    }
    if (!response.ok) {
      throw new TranscriptionRequestError({
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }
    return response;
  }
}

async function parseResponse(response: Response): Promise<z.infer<typeof responseSchema>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new IncompatibleTranscriptionResponseError("invalid_json");
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleTranscriptionResponseError("invalid_response_shape");
  }
  return parsed.data;
}

function createTranscriptionResult(
  parsed: z.infer<typeof responseSchema>,
  requestedLanguage: string,
): TranscriptionProviderResult {
  if (parsed.words === undefined || parsed.words.length === 0) {
    if (parsed.text.trim().length === 0) return { attempts: 1, pieces: [] };
    throw new IncompatibleTranscriptionResponseError("missing_timestamps");
  }
  const words = parsed.words.map((word) => ({
    endedAtMs: Math.round(word.end * 1_000),
    startedAtMs: Math.round(word.start * 1_000),
    text: word.word.trim(),
  }));
  if (words.some((piece) => piece.endedAtMs <= piece.startedAtMs)) {
    throw new IncompatibleTranscriptionResponseError("invalid_timestamps");
  }
  if (requestedLanguage === "auto" && parsed.language === undefined) {
    throw new IncompatibleTranscriptionResponseError("missing_language");
  }
  return {
    attempts: 1,
    ...(parsed.language === undefined ? {} : { detectedLanguage: detectedLanguage(parsed) }),
    pieces: groupWords(words),
    words,
  };
}

function detectedLanguage(parsed: z.infer<typeof responseSchema>) {
  if (parsed.language === undefined)
    throw new IncompatibleTranscriptionResponseError("missing_language");
  return {
    language: parsed.language,
    ...(parsed.languageProbability === undefined
      ? {}
      : { probability: parsed.languageProbability }),
  };
}

function resolveOptions(options: FasterWhisperTranscriptionProviderOptions) {
  return {
    batchSize: resolveDefault(options.batchSize, 0),
    baseUrl: resolveDefault(options.baseUrl, "http://faster-whisper:8000"),
    device: resolveDefault(options.device, "auto"),
    fallback: resolveDefault(options.fallback, "none"),
    fetch: resolveDefault(options.fetch, fetch),
    prompt: resolveDefault(options.prompt, null),
    vad: localVadSchema.parse(resolveDefault(options.vad, {})),
  };
}

function resolveDefault<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function groupWords(words: readonly TranscriptPiece[]): TranscriptPiece[] {
  const pieces: TranscriptPiece[] = [];
  let current: TranscriptPiece | undefined;
  for (const word of words) {
    current =
      current === undefined
        ? word
        : {
            endedAtMs: word.endedAtMs,
            startedAtMs: current.startedAtMs,
            text: `${current.text} ${word.text}`,
          };
    if (/[.!?…]$/u.test(current.text)) {
      pieces.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) pieces.push(current);
  return pieces;
}
