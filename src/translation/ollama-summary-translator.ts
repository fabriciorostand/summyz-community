import { composeProtectedPrompt } from "../ai-system-prompt.js";
import type { ProviderCostRecorder } from "../cost/provider-cost-recorder.js";
import { requestOllamaStructured } from "../local-ai/ollama-client.js";
import { type PublicSummary, translatedPublicSummarySchema } from "../summary/summary-result.js";
import { publicSummaryJsonSchema } from "./openrouter-summary-translator.js";
import type { SummaryTranslator } from "./summary-translation.js";

interface OllamaSummaryTranslatorOptions {
  baseUrl?: string;
  costRecorder?: ProviderCostRecorder;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  generation?: {
    seed?: number | undefined;
    temperature?: number | undefined;
    think?: boolean | undefined;
  };
  model: string;
  prompt?: string | null;
  timeoutMs: number;
}

export class OllamaSummaryTranslator implements SummaryTranslator {
  readonly #options: OllamaSummaryTranslatorOptions;

  public constructor(options: OllamaSummaryTranslatorOptions) {
    this.#options = options;
  }

  public async translate(summary: PublicSummary, targetLanguage: string): Promise<PublicSummary> {
    const costAttempt = await this.#options.costRecorder?.beginLocal("ollama", this.#options.model);
    try {
      const translated = await requestOllamaStructured({
        ...(this.#options.baseUrl === undefined ? {} : { baseUrl: this.#options.baseUrl }),
        ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
        ...(this.#options.generation === undefined ? {} : { generation: this.#options.generation }),
        input: { summary },
        instruction: composeProtectedPrompt({
          ...(this.#options.prompt === undefined ? {} : { editablePrompt: this.#options.prompt }),
          phase: "translation",
          phaseLanguage: targetLanguage,
        }),
        jsonSchema: publicSummaryJsonSchema,
        model: this.#options.model,
        outputSchema: translatedPublicSummarySchema,
        timeoutMs: this.#options.timeoutMs,
      });
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishLocal(costAttempt, "success");
      }
      return translated;
    } catch (error) {
      if (costAttempt !== undefined) {
        await this.#options.costRecorder?.finishLocal(costAttempt, "failure");
      }
      throw error;
    }
  }
}
