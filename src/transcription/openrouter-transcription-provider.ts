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
const MAX_LOGGED_INVALID_TIMESTAMPS = 20;

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
        const result = await this.#request(input, attempt);
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

  async #request(
    input: Parameters<TranscriptionProvider["transcribe"]>[0],
    providerAttempt: number,
  ): Promise<{
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
      const reason = body === undefined ? "invalid_json" : "invalid_response_shape";
      this.#logger?.warn(
        {
          ...createRejectedResponseBase({
            configuredModel: this.#model,
            generationId,
            input,
            providerAttempt,
            reason,
          }),
          responseSchemaIssues: result.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.map(String),
          })),
        },
        "OpenRouter transcription response rejected",
      );
      throw new IncompatibleTranscriptionResponseError(reason);
    }
    const parsed = result.data;
    let pieces: {
      pieces: TranscriptPiece[];
      usedAudioDurationFallback: boolean;
      words: TranscriptPiece[];
    };
    try {
      pieces = parseTranscriptPieces(parsed, input.audioDurationMs);
    } catch (error) {
      if (costAttempt !== undefined) {
        await this.#costRecorder?.finishOpenRouterResponse(costAttempt, {
          body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      if (error instanceof IncompatibleTranscriptionResponseError) {
        this.#logger?.warn(
          createRejectedResponseDiagnostic({
            configuredModel: this.#model,
            generationId,
            input,
            parsed,
            providerAttempt,
            reason: error.reason,
          }),
          "OpenRouter transcription response rejected",
        );
      }
      throw error;
    }
    if (pieces.usedAudioDurationFallback) {
      this.#logger?.warn(
        createRejectedResponseDiagnostic({
          configuredModel: this.#model,
          generationId,
          input,
          parsed,
          providerAttempt,
          reason: "invalid_timestamps",
        }),
        "OpenRouter transcription timestamps replaced with audio duration",
      );
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
      this.#logger?.warn(
        createRejectedResponseDiagnostic({
          configuredModel: this.#model,
          generationId,
          input,
          parsed,
          providerAttempt,
          reason: "missing_language",
        }),
        "OpenRouter transcription response rejected",
      );
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
      pieces: pieces.pieces,
      words: pieces.words,
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

interface RejectedResponseDiagnosticInput {
  configuredModel: string;
  generationId: string | undefined;
  input: Parameters<TranscriptionProvider["transcribe"]>[0];
  parsed: z.infer<typeof responseSchema>;
  providerAttempt: number;
  reason: IncompatibleTranscriptionResponseError["reason"];
}

function createRejectedResponseDiagnostic(input: RejectedResponseDiagnosticInput) {
  const invalidTimestamps = (input.parsed.words ?? [])
    .map((word, index) => createInvalidTimestampDiagnostic(word, index))
    .filter((item) => item !== undefined);
  return {
    ...createRejectedResponseBase(input),
    ...(input.parsed.model === undefined ? {} : { effectiveModel: input.parsed.model }),
    invalidTimestampCount: invalidTimestamps.length,
    invalidTimestamps: invalidTimestamps.slice(0, MAX_LOGGED_INVALID_TIMESTAMPS),
    invalidTimestampsTruncated: invalidTimestamps.length > MAX_LOGGED_INVALID_TIMESTAMPS,
    responseSegmentCount: input.parsed.segments?.length ?? 0,
    responseTextLength: input.parsed.text.length,
    responseWordCount: input.parsed.words?.length ?? 0,
  };
}

function createRejectedResponseBase(input: Omit<RejectedResponseDiagnosticInput, "parsed">) {
  return {
    ...(input.input.audioDurationMs === undefined
      ? {}
      : { audioDurationMs: input.input.audioDurationMs }),
    configuredModel: input.configuredModel,
    ...(input.generationId === undefined ? {} : { generationId: input.generationId }),
    incompatibilityReason: input.reason,
    provider: "openrouter",
    providerAttempt: input.providerAttempt,
  };
}

function createInvalidTimestampDiagnostic(item: z.infer<typeof timedTextSchema>, index: number) {
  const startedAtMs = Math.round(item.start * 1_000);
  const endedAtMs = Math.round(item.end * 1_000);
  if (endedAtMs > startedAtMs) return undefined;
  return {
    endedAtMs,
    endSeconds: item.end,
    index,
    issue: item.end <= item.start ? "non_positive_duration" : "collapsed_after_rounding",
    startedAtMs,
    startSeconds: item.start,
  };
}

function parseTranscriptPieces(
  parsed: z.infer<typeof responseSchema>,
  audioDurationMs: number | undefined,
): {
  pieces: TranscriptPiece[];
  usedAudioDurationFallback: boolean;
  words: TranscriptPiece[];
} {
  const wordsResult = parseTimedItems(parsed.words);
  if (wordsResult?.success === true) {
    const words = parsed.words?.map(toTranscriptPiece) ?? [];
    return { pieces: wordsResult.pieces, usedAudioDurationFallback: false, words };
  }
  if (wordsResult === undefined) {
    const text = parsed.text.trim();
    if (text.length === 0) {
      return { pieces: [], usedAudioDurationFallback: false, words: [] };
    }
    throw new IncompatibleTranscriptionResponseError("missing_timestamps");
  }
  const text = parsed.text.trim();
  if (
    wordsResult.reason === "invalid_timestamps" &&
    hasOnlyZeroLengthOriginTimestamps(parsed.words) &&
    text.length > 0 &&
    audioDurationMs !== undefined &&
    Number.isFinite(audioDurationMs) &&
    audioDurationMs > 0
  ) {
    return {
      pieces: [{ endedAtMs: audioDurationMs, startedAtMs: 0, text }],
      usedAudioDurationFallback: true,
      words: [],
    };
  }
  throw new IncompatibleTranscriptionResponseError(wordsResult.reason);
}

function hasOnlyZeroLengthOriginTimestamps(
  items: readonly z.infer<typeof timedTextSchema>[] | undefined,
): boolean {
  const invalidItems = (items ?? []).filter((item) => hasInvalidTimestamp(toTranscriptPiece(item)));
  return (
    invalidItems.length > 0 && invalidItems.every((item) => item.start === 0 && item.end === 0)
  );
}

type TimedItemsResult =
  | { pieces: TranscriptPiece[]; success: true }
  | { reason: "invalid_response_shape" | "invalid_timestamps"; success: false };

function parseTimedItems(
  items: readonly z.infer<typeof timedTextSchema>[] | undefined,
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
    pieces: groupWords(items),
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
