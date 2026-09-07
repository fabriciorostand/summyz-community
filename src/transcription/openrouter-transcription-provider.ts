import type { Logger } from "pino";

import type { CostAttempt } from "../cost/cost-ledger.js";
import { getOpenRouterGenerationId, readOpenRouterResponse } from "../cost/openrouter-response.js";
import type { ProviderCostRecorder } from "../cost/provider-cost-recorder.js";

import type {
  TranscriptionProvider,
  TranscriptionProviderResult,
  TranscriptPiece,
} from "./transcription-provider.js";
import {
  IncompatibleTranscriptionResponseError,
  TranscriptionRequestError,
} from "./transcription-provider.js";

export type { TranscriptionIncompatibilityReason } from "./transcription-provider.js";
export {
  IncompatibleTranscriptionResponseError,
  TranscriptionRequestError,
} from "./transcription-provider.js";

import {
  createRejectedResponseBase,
  createRejectedResponseDiagnostic,
  type ParsedTranscriptionResponse,
  parseTranscriptPieces,
  responseSchema,
} from "./openrouter-transcription-response.js";
import type { TranscriptionModelProfile } from "./transcription-model-profile.js";

const OPENROUTER_TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number) => Promise<void>;
type TranscriptionInput = Parameters<TranscriptionProvider["transcribe"]>[0];

interface OpenRouterResponseContext {
  body: unknown;
  exactCost: string | undefined;
  generationId: string | undefined;
}

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
        if (!shouldRetry(error, attempt, this.#maxAttempts)) throw error;
        const delayMs = retryDelay(
          error,
          attempt,
          this.#retryBaseMs,
          this.#retryMaxMs,
          this.#random(),
        );
        this.#logger?.warn(
          retryDiagnostic(error, attempt, delayMs),
          "Transcription attempt failed; another attempt will be made",
        );
        await this.#sleep(delayMs);
      }
    }
    throw lastError;
  }

  async #request(
    input: TranscriptionInput,
    providerAttempt: number,
  ): Promise<{
    detectedLanguage?: NonNullable<TranscriptionProviderResult["detectedLanguage"]>;
    pieces: TranscriptPiece[];
    words: TranscriptPiece[];
  }> {
    const costAttempt = await this.#costRecorder?.beginApi("openrouter");
    const selectedLanguage = input.language ?? this.#language ?? this.#profile.language;
    const language = selectedLanguage === "auto" ? undefined : selectedLanguage;
    const response = await this.#sendRequest(input, language, costAttempt);
    if (!response.ok) await this.#rejectHttpResponse(response, costAttempt);
    const context = await createResponseContext(response);
    const parsed = await this.#validateResponse(context, input, providerAttempt, costAttempt);
    const pieces = await this.#parseResponsePieces(
      parsed,
      context,
      input,
      providerAttempt,
      costAttempt,
    );
    this.#warnAboutTimestampFallback(
      pieces.usedAudioDurationFallback,
      parsed,
      context,
      input,
      providerAttempt,
    );
    await this.#requireDetectedLanguage(
      parsed,
      language,
      context,
      input,
      providerAttempt,
      costAttempt,
    );
    await this.#finishResponseCost(costAttempt, context, "success");
    return createProviderResult(parsed, pieces);
  }

  async #sendRequest(
    input: TranscriptionInput,
    language: string | undefined,
    costAttempt: CostAttempt | undefined,
  ): Promise<Response> {
    try {
      return await this.#fetch(OPENROUTER_TRANSCRIPTION_URL, {
        body: JSON.stringify(createRequestBody(input, language, this.#model, this.#profile)),
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled",
        },
        method: "POST",
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      if (costAttempt !== undefined)
        await this.#costRecorder?.finishUnattributed(costAttempt, "failure");
      throw new TranscriptionRequestError({ retryable: true });
    }
  }

  async #rejectHttpResponse(
    response: Response,
    costAttempt: CostAttempt | undefined,
  ): Promise<never> {
    const context = await createResponseContext(response);
    await this.#finishResponseCost(costAttempt, context, "failure");
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new TranscriptionRequestError({
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      retryable: isRetryableStatus(response.status),
      status: response.status,
    });
  }

  async #validateResponse(
    context: OpenRouterResponseContext,
    input: TranscriptionInput,
    providerAttempt: number,
    costAttempt: CostAttempt | undefined,
  ): Promise<ParsedTranscriptionResponse> {
    const result = responseSchema.safeParse(context.body);
    if (result.success) return result.data;
    await this.#finishResponseCost(costAttempt, context, "failure");
    const reason = context.body === undefined ? "invalid_json" : "invalid_response_shape";
    this.#logger?.warn(
      {
        ...createRejectedResponseBase({
          configuredModel: this.#model,
          generationId: context.generationId,
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

  async #parseResponsePieces(
    parsed: ParsedTranscriptionResponse,
    context: OpenRouterResponseContext,
    input: TranscriptionInput,
    providerAttempt: number,
    costAttempt: CostAttempt | undefined,
  ): Promise<ReturnType<typeof parseTranscriptPieces>> {
    try {
      return parseTranscriptPieces(parsed, input.audioDurationMs);
    } catch (error) {
      await this.#finishResponseCost(costAttempt, context, "failure");
      if (error instanceof IncompatibleTranscriptionResponseError) {
        this.#logger?.warn(
          createRejectedResponseDiagnostic({
            configuredModel: this.#model,
            generationId: context.generationId,
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
  }

  #warnAboutTimestampFallback(
    usedFallback: boolean,
    parsed: ParsedTranscriptionResponse,
    context: OpenRouterResponseContext,
    input: TranscriptionInput,
    providerAttempt: number,
  ): void {
    if (!usedFallback) return;
    this.#logger?.warn(
      createRejectedResponseDiagnostic({
        configuredModel: this.#model,
        generationId: context.generationId,
        input,
        parsed,
        providerAttempt,
        reason: "invalid_timestamps",
      }),
      "OpenRouter transcription timestamps replaced with audio duration",
    );
  }

  async #requireDetectedLanguage(
    parsed: ParsedTranscriptionResponse,
    language: string | undefined,
    context: OpenRouterResponseContext,
    input: TranscriptionInput,
    providerAttempt: number,
    costAttempt: CostAttempt | undefined,
  ): Promise<void> {
    if (!isMissingDetectedLanguage(parsed, language)) return;
    await this.#finishResponseCost(costAttempt, context, "failure");
    this.#logger?.warn(
      createRejectedResponseDiagnostic({
        configuredModel: this.#model,
        generationId: context.generationId,
        input,
        parsed,
        providerAttempt,
        reason: "missing_language",
      }),
      "OpenRouter transcription response rejected",
    );
    throw new IncompatibleTranscriptionResponseError("missing_language");
  }

  async #finishResponseCost(
    attempt: CostAttempt | undefined,
    context: OpenRouterResponseContext,
    outcome: "failure" | "success",
  ): Promise<void> {
    if (attempt === undefined) return;
    await this.#costRecorder?.finishOpenRouterResponse(attempt, {
      body: context.body,
      exactCost: context.exactCost,
      ...(context.generationId === undefined ? {} : { generationId: context.generationId }),
      outcome,
    });
  }
}

async function createResponseContext(response: Response): Promise<OpenRouterResponseContext> {
  const parsedResponse = await readOpenRouterResponse(response);
  return {
    body: parsedResponse.body,
    exactCost: parsedResponse.exactCost,
    generationId: getOpenRouterGenerationId(response),
  };
}

function createRequestBody(
  input: TranscriptionInput,
  language: string | undefined,
  model: string,
  profile: TranscriptionModelProfile,
) {
  return {
    input_audio: {
      data: Buffer.from(input.audio).toString("base64"),
      format: input.format,
    },
    ...(language === undefined ? {} : { language }),
    model,
    ...(profile.prompt === undefined ? {} : { prompt: profile.prompt }),
    ...(profile.providerOptions === undefined
      ? {}
      : { provider: { options: profile.providerOptions } }),
    response_format: "verbose_json",
    ...(profile.temperature === undefined ? {} : { temperature: profile.temperature }),
    timestamp_granularities: ["word", "segment"],
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isMissingDetectedLanguage(
  parsed: ParsedTranscriptionResponse,
  requestedLanguage: string | undefined,
): boolean {
  return (
    requestedLanguage === undefined &&
    parsed.text.trim().length > 0 &&
    parsed.language === undefined
  );
}

function createProviderResult(
  parsed: ParsedTranscriptionResponse,
  pieces: ReturnType<typeof parseTranscriptPieces>,
): {
  detectedLanguage?: NonNullable<TranscriptionProviderResult["detectedLanguage"]>;
  pieces: TranscriptPiece[];
  words: TranscriptPiece[];
} {
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

function isRetryable(error: unknown): boolean {
  return (
    (error instanceof TranscriptionRequestError && error.retryable) ||
    (error instanceof IncompatibleTranscriptionResponseError &&
      error.reason !== "invalid_audio_duration")
  );
}

function shouldRetry(error: unknown, attempt: number, maximumAttempts: number): boolean {
  return attempt < maximumAttempts && isRetryable(error);
}

function retryDelay(
  error: unknown,
  attempt: number,
  baseMilliseconds: number,
  maximumMilliseconds: number,
  random: number,
): number {
  const exponential = Math.min(baseMilliseconds * 2 ** (attempt - 1), maximumMilliseconds);
  const retryAfter = error instanceof TranscriptionRequestError ? (error.retryAfterMs ?? 0) : 0;
  const baseDelay = Math.min(Math.max(exponential, retryAfter), maximumMilliseconds);
  return Math.round(baseDelay * (1 + random * 0.25));
}

function retryDiagnostic(error: unknown, attempt: number, delayMs: number) {
  return {
    attempt,
    delayMs,
    errorType: getErrorType(error),
    incompatibilityReason:
      error instanceof IncompatibleTranscriptionResponseError ? error.reason : undefined,
    status: error instanceof TranscriptionRequestError ? error.status : undefined,
  };
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
