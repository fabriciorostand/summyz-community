import { composeProtectedPrompt } from "../ai-system-prompt.js";
import type { ProviderCostRecorder } from "../cost/provider-cost-recorder.js";
import { getOpenRouterGenerationId, readOpenRouterResponse } from "../cost/openrouter-response.js";
import {
  artifactLabelsJsonSchema,
  type PublicSummary,
  translatedPublicSummarySchema,
} from "../summary/summary-result.js";
import { type SummaryTranslator, TranslationRequestError } from "./summary-translation.js";
import { z } from "zod";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().min(1) }) })).min(1),
});

interface OpenRouterSummaryTranslatorOptions {
  apiKey: string;
  costRecorder?: ProviderCostRecorder;
  fetch?: Fetch;
  generation?: { seed?: number | undefined; temperature?: number | undefined };
  model: string;
  prompt?: string | null;
  timeoutMs: number;
}

export class OpenRouterSummaryTranslator implements SummaryTranslator {
  readonly #options: OpenRouterSummaryTranslatorOptions;

  public constructor(options: OpenRouterSummaryTranslatorOptions) {
    this.#options = options;
  }

  public async translate(summary: PublicSummary, targetLanguage: string): Promise<PublicSummary> {
    const costAttempt = await this.#options.costRecorder?.beginApi("openrouter");
    let response: Response;
    try {
      response = await (this.#options.fetch ?? fetch)(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          body: JSON.stringify({
            messages: [
              {
                content: composeProtectedPrompt({
                  ...(this.#options.prompt === undefined
                    ? {}
                    : { editablePrompt: this.#options.prompt }),
                  phase: "translation",
                  phaseLanguage: targetLanguage,
                }),
                role: "system",
              },
              { content: JSON.stringify({ summary }), role: "user" },
            ],
            model: this.#options.model,
            provider: { require_parameters: true },
            response_format: {
              json_schema: {
                name: "translated_meeting_summary",
                schema: publicSummaryJsonSchema,
                strict: true,
              },
              type: "json_schema",
            },
            ...(this.#options.generation?.seed === undefined
              ? {}
              : { seed: this.#options.generation.seed }),
            stream: false,
            ...(this.#options.generation?.temperature === undefined
              ? {}
              : { temperature: this.#options.generation.temperature }),
          }),
          headers: {
            Authorization: `Bearer ${this.#options.apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: AbortSignal.timeout(this.#options.timeoutMs),
        },
      );
    } catch {
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishUnattributed(costAttempt, "failure");
      }
      throw new TranslationRequestError(true);
    }
    let parsedResponse: Awaited<ReturnType<typeof readOpenRouterResponse>>;
    try {
      parsedResponse = await readOpenRouterResponse(response);
    } catch {
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishUnattributed(costAttempt, "failure");
      }
      throw new TranslationRequestError(true);
    }
    const generationId = getOpenRouterGenerationId(response);
    if (!response.ok) {
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishOpenRouterResponse(costAttempt, {
          body: parsedResponse.body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      throw new TranslationRequestError(
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    let translated: PublicSummary;
    try {
      const body = responseSchema.parse(parsedResponse.body);
      const content = body.choices[0]?.message.content;
      if (content === undefined) throw new Error("Invalid translation response");
      const parsed: unknown = JSON.parse(content);
      translated = translatedPublicSummarySchema.parse(parsed);
    } catch {
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishOpenRouterResponse(costAttempt, {
          body: parsedResponse.body,
          exactCost: parsedResponse.exactCost,
          ...(generationId === undefined ? {} : { generationId }),
          outcome: "failure",
        });
      }
      throw new Error("The translation response did not match the required structure");
    }
    if (costAttempt !== undefined) {
      await this.#options.costRecorder?.finishOpenRouterResponse(costAttempt, {
        body: parsedResponse.body,
        exactCost: parsedResponse.exactCost,
        ...(generationId === undefined ? {} : { generationId }),
        outcome: "success",
      });
    }
    return translated;
  }
}

export const publicSummaryJsonSchema = {
  additionalProperties: false,
  properties: {
    decisions: { items: { minLength: 1, type: "string" }, type: "array" },
    discussedTopics: { items: { minLength: 1, type: "string" }, type: "array" },
    executiveSummary: { minLength: 1, type: "string" },
    labels: artifactLabelsJsonSchema,
    observations: { items: { minLength: 1, type: "string" }, type: "array" },
    tasks: {
      items: {
        additionalProperties: false,
        properties: {
          deadlineText: { minLength: 1, type: "string" },
          ownerName: { minLength: 1, type: "string" },
          text: { minLength: 1, type: "string" },
        },
        required: ["text"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["decisions", "discussedTopics", "executiveSummary", "labels", "observations", "tasks"],
  type: "object",
} as const;
