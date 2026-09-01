import { z } from "zod";
import type { Logger } from "pino";

import type { ProviderCostRecorder } from "../cost/provider-cost-recorder.js";
import { getOpenRouterGenerationId, readOpenRouterResponse } from "../cost/openrouter-response.js";

import type {
  TranscriptPiece,
  TranscriptionProvider,
  TranscriptionProviderResult,
} from "./transcription-provider.js";
import {
  IncompatibleTranscriptionResponseError,
  TranscriptionRequestError,
} from "./transcription-provider.js";
export {
  IncompatibleTranscriptionResponseError,
  TranscriptionRequestError,
} from "./transcription-provider.js";
export type { TranscriptionIncompatibilityReason } from "./transcription-provider.js";
import type { TranscriptionModelProfile } from "./transcription-model-profile.js";

const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

const timedTextSchema = z.object({
  end: z.number().nonnegative(),
  start: z.number().nonnegative(),
  text: z.string().optional(),
  word: z.string().optional(),
});

const responseSchema = z.object({
  language: z.string().min(2).max(64).optional(),
  language_probability: z.number().min(0).max(1).optional(),
  model: z.string().min(1).optional(),
  segments: z.array(timedTextSchema).optional(),
  text: z.string(),
  usage: z.object({ cost: z.number().nonnegative() }).passthrough().optional(),
  words: z.array(timedTextSchema).optional(),
});

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;

export interface OpenRouterTranscriptionProviderOptions {
  apiKey: string;
  costRecorder?: ProviderCostRecorder;
  fetch?: Fetch;
  language?: string;
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

export class OpenRouterTranscriptionProvider implements TranscriptionProvider {
  readonly #apiKey: string;
  readonly #costRecorder: ProviderCostRecorder | undefined;
  readonly #fetch: Fetch;
  readonly #maxAttempts: number;
  readonly #logger: Logger | undefined;
  readonly #language: string | undefined;
  readonly #model: string;
  readonly #profile: TranscriptionModelProfile;
  readonly #random: () => number;
  readonly #retryBaseMs: number;
  readonly #retryMaxMs: number;
  readonly #sleep: Sleep;
  readonly #timeoutMs: number;

  public constructor(options: OpenRouterTranscriptionProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#costRecorder = options.costRecorder;
    this.#fetch = options.fetch ?? fetch;
    this.#maxAttempts = options.maxAttempts;
    this.#logger = options.logger;
    this.#language = options.language;
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
        const result = await this.#request(input);
        return { attempts: attempt, ...result };
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
            incompatibilityReason:
              error instanceof IncompatibleTranscriptionResponseError ? error.reason : undefined,
            status: error instanceof TranscriptionRequestError ? error.status : undefined,
          },
          "Transcription attempt failed; another attempt will be made",
        );
        await this.#sleep(delayMs);
      }
    }
    throw lastError;
  }

  async #request(input: Parameters<TranscriptionProvider["transcribe"]>[0]): Promise<{
    detectedLanguage?: NonNullable<TranscriptionProviderResult["detectedLanguage"]>;
    pieces: TranscriptPiece[];
    words: TranscriptPiece[];
  }> {
    const costAttempt = await this.#costRecorder?.beginApi("openrouter");
    const selectedLanguage = input.language ?? this.#language ?? this.#profile.language;
    const language = selectedLanguage === "auto" ? undefined : selectedLanguage;
    const inputAudio = {
      data: Buffer.from(input.audio).toString("base64"),
      format: input.format,
    };
    let response: Response;
    try {
      response = await this.#fetch(OPENROUTER_TRANSCRIPTION_URL, {
        body: JSON.stringify({
          input_audio: inputAudio,
          ...(language === undefined ? {} : { language }),
          model: this.#model,
          ...(this.#profile.prompt === undefined ? {} : { prompt: this.#profile.prompt }),
          ...(this.#profile.providerOptions === undefined
            ? {}
            : { provider: { options: this.#profile.providerOptions } }),
          response_format: "verbose_json",
          ...(this.#profile.temperature === undefined
            ? {}
            : { temperature: this.#profile.temperature }),
          timestamp_granularities: ["word", "segment"],
        }),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishUnattributed(costAttempt, "failure");
      }
      throw new TranscriptionRequestError({ retryable: true });
    }

    if (!response.ok) {
      const parsedResponse = await readOpenRouterResponse(response);
      const generationId = getOpenRouterGenerationId(response);
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
          body: parsedResponse.body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw new TranscriptionRequestError({
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        status: response.status,
      });
    }

    const parsedResponse = await readOpenRouterResponse(response);
    const body = parsedResponse.body;
    const generationId = getOpenRouterGenerationId(response);
    const result = responseSchema.safeParse(body);
    if (!result.success) {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
          body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      if (body === undefined) throw new IncompatibleTranscriptionResponseError("invalid_json");
      throw new IncompatibleTranscriptionResponseError("invalid_response_shape");
    }
    const parsed = result.data;
    let pieces: { pieces: TranscriptPiece[]; words: TranscriptPiece[] };
    try {
      pieces = parseTranscriptPieces(parsed);
    } catch (error) {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
          body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      throw error;
    }
    if (language === undefined && parsed.text.trim().length > 0 && parsed.language === undefined) {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
          body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      throw new IncompatibleTranscriptionResponseError("missing_language");
    }
    if (costAttempt !== undefined) {
      await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
        body,
        exactCost: parsedResponse.exactCost,
        ...(generationId === undefined ? {} : { generationId }),
        outcome: "success",
      });
    }
    return {
      ...pieces,
      ...(parsed.language === undefined
        ? {}
        : {
            detectedLanguage: {
              language: parsed.language,
              ...(parsed.language_probability === undefined
                ? {}
                : { probability: parsed.language_probability }),
            },
          }),
    };
  }
}

function parseTranscriptPieces(parsed: z.infer<typeof responseSchema>): {
  pieces: TranscriptPiece[];
  words: TranscriptPiece[];
} {
  const wordsResult = parseTimedItems(parsed.words, true);
  if (wordsResult?.success === true) {
    const words = parsed.words?.map(toTranscriptPiece) ?? [];
    return { pieces: wordsResult.pieces, words };
  }
  if (wordsResult === undefined) {
    const text = parsed.text.trim();
    if (text.length === 0) return { pieces: [], words: [] };
    throw new IncompatibleTranscriptionResponseError("missing_timestamps");
  }
  throw new IncompatibleTranscriptionResponseError(wordsResult.reason);
}

type TimedItemsResult =
  | { pieces: TranscriptPiece[]; success: true }
  | { reason: "invalid_response_shape" | "invalid_timestamps"; success: false };

function parseTimedItems(
  items: readonly z.infer<typeof timedTextSchema>[] | undefined,
  shouldGroupWords: boolean,
): TimedItemsResult | undefined {
  if (items === undefined || !items.some((item) => getTimedItemText(item).length > 0)) {
    return undefined;
  }
  if (items.some((item) => getTimedItemText(item).length === 0)) {
    return { reason: "invalid_response_shape", success: false };
  }
  const rawPieces = items.map((item) => toTranscriptPiece(item));
  if (rawPieces.some(hasInvalidTimestamp)) {
    return { reason: "invalid_timestamps", success: false };
  }
  return {
    pieces: shouldGroupWords ? groupWords(items) : rawPieces,
    success: true,
  };
}

function hasInvalidTimestamp(piece: TranscriptPiece): boolean {
  return piece.endedAtMs <= piece.startedAtMs || piece.startedAtMs < 0;
}

function getTimedItemText(item: z.infer<typeof timedTextSchema>): string {
  return (item.text ?? item.word ?? "").trim();
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
    text: getTimedItemText(item),
  };
}

function isRetryable(error: unknown): boolean {
  return (
    (error instanceof TranscriptionRequestError && error.retryable) ||
    (error instanceof IncompatibleTranscriptionResponseError &&
      error.reason !== "invalid_audio_duration")
  );
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
