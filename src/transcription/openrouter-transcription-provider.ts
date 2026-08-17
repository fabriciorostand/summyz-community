import { z } from "zod";
import type { Logger } from "pino";

import type {
  TranscriptPiece,
  TranscriptionProvider,
  TranscriptionProviderResult,
} from "./transcription-provider.js";
import type { TranscriptionModelProfile } from "./transcription-model-profile.js";

const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

const timedTextSchema = z.object({
  end: z.number().nonnegative(),
  start: z.number().nonnegative(),
  text: z.string().optional(),
  word: z.string().optional(),
});

const responseSchema = z.object({
  segments: z.array(timedTextSchema).optional(),
  text: z.string(),
  words: z.array(timedTextSchema).optional(),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

export interface OpenRouterTranscriptionProviderOptions {
  apiKey: string;
  fetch?: Fetch;
  logger?: Logger;
  maxAttempts: number;
  model: string;
  profile: TranscriptionModelProfile;
  random?: () => number;
  retryBaseMs: number;
  retryMaxMs: number;
  sleep?: Sleep;
  timeoutMs: number;
}

export class TranscriptionRequestError extends Error {
  public readonly retryAfterMs: number | undefined;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(input: {
    retryAfterMs?: number;
    retryable: boolean;
    status?: number;
  }) {
    super(
      input.status === undefined
        ? "A requisição de transcrição falhou"
        : `A requisição de transcrição falhou com status ${String(input.status)}`,
    );
    this.name = "TranscriptionRequestError";
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export class IncompatibleTranscriptionResponseError extends Error {
  public constructor() {
    super("O modelo configurado não retornou timestamps compatíveis");
    this.name = "IncompatibleTranscriptionResponseError";
  }
}

export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  readonly #apiKey: string;
  readonly #fetch: Fetch;
  readonly #maxAttempts: number;
  readonly #logger: Logger | undefined;
  readonly #model: string;
  readonly #profile: TranscriptionModelProfile;
  readonly #random: () => number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #sleep: Sleep;
  readonly #timeoutMs: number;

  public constructor(options: OpenRouterTranscriptionProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? fetch;
    this.#maxAttempts = options.maxAttempts;
    this.#logger = options.logger;
    this.#model = options.model;
    this.#profile = options.profile;
    this.#random = options.random ?? Math.random;
    this.#retryBaseMs = options.retryBaseMs;
    this.#retryMaxMs = options.retryMaxMs;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs;
  }

  public async transcribe(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
  ): Promise<TranscriptionProviderResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.#maxAttempts; attempt += 1) {
      try {
        const pieces = await this.#request(input);
        return { attempts: attempt, pieces };
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.#maxAttempts) {
          throw error;
        }
        const exponentialDelay = Math.min(this.#retryBaseMs * 2 ** (attempt - 1), this.#retryMaxMs);
        const retryAfterMs =
          error instanceof TranscriptionRequestError ? error.retryAfterMs : undefined;
        const baseDelay = Math.min(Math.max(exponentialDelay, retryAfterMs ?? 0), this.#retryMaxMs);
        const delayMs = Math.round(baseDelay * (1 + this.#random() * 0.25));
        this.#logger?.warn(
          {
            attempt,
            delayMs,
            errorType: getErrorType(error),
            status: error instanceof TranscriptionRequestError ? error.status : undefined,
          },
          "Tentativa de transcrição falhou; uma nova tentativa será realizada",
        );
        await this.#sleep(delayMs);
      }
    }
    throw lastError;
  }

  async #request(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
  ): Promise<TranscriptPiece[]> {
    const acceptsUntimedText = this.#profile.timestampMode === "batch";
    const inputAudio = {
      data: Buffer.from(input.audio).toString("base64"),
      format: input.format,
    };
    let response: Response;
    try {
      response = await this.#fetch(OPENROUTER_TRANSCRIPTION_URL, {
        body: JSON.stringify({
          input_audio: inputAudio,
          ...(this.#profile.language === undefined ? {} : { language: this.#profile.language }),
          model: this.#model,
          ...(this.#profile.providerOptions === undefined
            ? {}
            : { provider: { options: this.#profile.providerOptions } }),
          response_format: acceptsUntimedText ? "json" : "verbose_json",
          temperature: this.#profile.temperature,
          ...(acceptsUntimedText ? {} : { timestamp_granularities: ["word"] }),
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new TranscriptionRequestError({ retryable: true });
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw new TranscriptionRequestError({
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }

    let parsed: z.infer<typeof responseSchema>;
    try {
      const body: unknown = await response.json();
      parsed = responseSchema.parse(body);
    } catch {
      throw new IncompatibleTranscriptionResponseError();
    }

    const timedItems = parsed.words ?? parsed.segments;
    const hasTimedText = timedItems?.some(
      (item) => (item.text ?? item.word ?? "").trim().length > 0,
    );
    if (hasTimedText !== true) {
      const text = parsed.text.trim();
      if (text.length === 0) {
        return [];
      }
      if (
        !acceptsUntimedText ||
        input.audioDurationMs === undefined ||
        !Number.isFinite(input.audioDurationMs) ||
        input.audioDurationMs <= 0
      ) {
        throw new IncompatibleTranscriptionResponseError();
      }
      return [{ endedAtMs: Math.round(input.audioDurationMs), startedAtMs: 0, text }];
    }
    if (timedItems === undefined) {
      throw new IncompatibleTranscriptionResponseError();
    }
    const pieces =
      parsed.words === undefined
        ? timedItems.map((item) => toTranscriptPiece(item))
        : groupWords(timedItems);
    if (
      pieces.some(
        (piece) =>
          piece.text.length === 0 || piece.endedAtMs <= piece.startedAtMs || piece.startedAtMs < 0,
      )
    ) {
      throw new IncompatibleTranscriptionResponseError();
    }
    return pieces;
  }
}

function groupWords(words: readonly z.infer<typeof timedTextSchema>[]): TranscriptPiece[] {
  const pieces: TranscriptPiece[] = [];
  let current: TranscriptPiece | undefined;
  for (const word of words) {
    const piece = toTranscriptPiece(word);
    if (current === undefined) {
      current = piece;
    } else {
      current = {
        endedAtMs: piece.endedAtMs,
        startedAtMs: current.startedAtMs,
        text: `${current.text} ${piece.text}`,
      };
    }
    if (/[.!?…]$/u.test(current.text)) {
      pieces.push(current);
      current = undefined;
    }
  }
  if (current !== undefined) {
    pieces.push(current);
  }
  return pieces;
}

function toTranscriptPiece(item: z.infer<typeof timedTextSchema>): TranscriptPiece {
  return {
    endedAtMs: Math.round(item.end * 1_000),
    startedAtMs: Math.round(item.start * 1_000),
    text: (item.text ?? item.word ?? "").trim(),
  };
}

function isRetryable(error: unknown): boolean {
  return error instanceof TranscriptionRequestError && error.retryable;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

async function defaultSleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
