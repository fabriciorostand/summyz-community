import { z } from "zod";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_STT_MODELS_URL = `${OPENROUTER_MODELS_URL}?output_modalities=transcription`;

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
      const [models, transcriptionModels] = await Promise.all([
        this.#loadModels(OPENROUTER_MODELS_URL),
        this.#loadModels(OPENROUTER_STT_MODELS_URL),
      ]);
      requireTranscriptionModel(transcriptionModels.get(input.transcriptionModel));
      for (const id of new Set(input.generativeModels)) requireGenerativeModel(models.get(id));
    } catch (error) {
      if (error instanceof OpenRouterModelPreflightError) throw error;
      throw new OpenRouterModelPreflightError();
    }
  }

  async #loadModels(url: string): Promise<Map<string, z.infer<typeof modelSchema>>> {
    const response = await this.#fetch(url, {
      headers: { Authorization: `Bearer ${this.#apiKey}` },
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new OpenRouterModelPreflightError();
    const parsed = catalogSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new OpenRouterModelPreflightError();
    return new Map(parsed.data.data.map((model) => [model.id, model]));
  }
}

type CatalogModel = z.infer<typeof modelSchema>;

function requireTranscriptionModel(model: CatalogModel | undefined): void {
  const supportsAudio = model?.architecture.input_modalities.includes("audio") === true;
  const producesTranscription =
    model?.architecture.output_modalities.includes("transcription") === true;
  const supportsResponseFormat = model?.supported_parameters.includes("response_format") === true;
  if (!supportsAudio || !producesTranscription || !supportsResponseFormat) {
    throw new OpenRouterModelPreflightError();
  }
}

function requireGenerativeModel(model: CatalogModel | undefined): void {
  const acceptsText = model?.architecture.input_modalities.includes("text") === true;
  const producesText = model?.architecture.output_modalities.includes("text") === true;
  const producesJson = model?.supported_parameters.includes("response_format") === true;
  if (!acceptsText || !producesText || !producesJson) throw new OpenRouterModelPreflightError();
}
