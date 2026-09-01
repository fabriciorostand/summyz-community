import { z } from "zod";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const modelSchema = z.object({
  architecture: z.object({
    input_modalities: z.array(z.string()),
    output_modalities: z.array(z.string()),
  }),
  id: z.string().min(1),
  supported_parameters: z.array(z.string()),
});
const catalogSchema = z.object({ data: z.array(modelSchema) });

export class OpenRouterModelPreflightError extends Error {
  public constructor() {
    super("The OpenRouter model catalog could not validate the active profile");
    this.name = "OpenRouterModelPreflightError";
  }
}

interface OpenRouterModelPreflightOptions {
  apiKey: string;
  fetch?: Fetch;
}

export class OpenRouterModelPreflight {
  readonly #apiKey: string;
  readonly #fetch: Fetch;

  public constructor(options: OpenRouterModelPreflightOptions) {
    this.#apiKey = z.string().min(1).parse(options.apiKey);
    this.#fetch = options.fetch ?? fetch;
  }

  public async validate(input: {
    generativeModels: readonly string[];
    transcriptionModel: string;
  }): Promise<void> {
    try {
      const response = await this.#fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new OpenRouterModelPreflightError();
      const parsed = catalogSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new OpenRouterModelPreflightError();
      const models = new Map(parsed.data.data.map((model) => [model.id, model]));
      const transcription = models.get(input.transcriptionModel);
      if (
        transcription === undefined ||
        !transcription.architecture.input_modalities.includes("audio") ||
        !transcription.architecture.output_modalities.includes("text")
      ) {
        throw new OpenRouterModelPreflightError();
      }
      for (const id of new Set(input.generativeModels)) {
        const model = models.get(id);
        if (
          model === undefined ||
          !model.architecture.input_modalities.includes("text") ||
          !model.architecture.output_modalities.includes("text") ||
          !model.supported_parameters.includes("response_format")
        ) {
          throw new OpenRouterModelPreflightError();
        }
      }
    } catch (error) {
      if (error instanceof OpenRouterModelPreflightError) throw error;
      throw new OpenRouterModelPreflightError();
    }
  }
}
