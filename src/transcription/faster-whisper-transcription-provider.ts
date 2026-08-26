import { z } from "zod";

import {
  IncompatibleTranscriptionResponseError,
  type TranscriptPiece,
  type TranscriptionProvider,
  type TranscriptionProviderResult,
  TranscriptionRequestError,
} from "./transcription-provider.js";

const responseSchema = z.object({
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
  baseUrl?: string;
  fetch?: Fetch;
  language: string;
  model: string;
  timeoutMs: number;
}

export class FasterWhisperTranscriptionProvider implements TranscriptionProvider {
  readonly #baseUrl: string;
  readonly #fetch: Fetch;
  readonly #language: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  public constructor(options: FasterWhisperTranscriptionProviderOptions) {
    this.#baseUrl = options.baseUrl ?? "http://faster-whisper:8000";
    this.#fetch = options.fetch ?? fetch;
    this.#language = options.language;
    this.#model = options.model;
    this.#timeoutMs = options.timeoutMs;
  }

  public async transcribe(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
  ): Promise<TranscriptionProviderResult> {
    const form = new FormData();
    const audioBuffer = new ArrayBuffer(input.audio.byteLength);
    new Uint8Array(audioBuffer).set(input.audio);
    form.set("audio", new Blob([audioBuffer]), `audio.${input.format}`);
    form.set("language", input.language ?? this.#language);
    form.set("model", this.#model);

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
    if (parsed.data.words === undefined || parsed.data.words.length === 0) {
      if (parsed.data.text.trim().length === 0) {
        return { attempts: 1, pieces: [] };
      }
      throw new IncompatibleTranscriptionResponseError("missing_timestamps");
    }

    const pieces = groupWords(
      parsed.data.words.map((word) => ({
        endedAtMs: Math.round(word.end * 1_000),
        startedAtMs: Math.round(word.start * 1_000),
        text: word.word.trim(),
      })),
    );
    if (pieces.some((piece) => piece.endedAtMs <= piece.startedAtMs)) {
      throw new IncompatibleTranscriptionResponseError("invalid_timestamps");
    }
    return { attempts: 1, pieces };
  }
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
