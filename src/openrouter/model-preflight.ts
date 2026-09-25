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

export type OpenRouterModelPhase = "transcription" | "refinement" | "summary";
export type OpenRouterModelPreflightReason =
  | "catalog_unavailable"
  | "catalog_invalid"
  | "model_missing"
  | "capability_missing";

export class OpenRouterModelPreflightError extends Error {
  public readonly reason: OpenRouterModelPreflightReason;
  public readonly phase: OpenRouterModelPhase | undefined;
  public readonly httpStatus: number | undefined;

  public constructor(
    reason: OpenRouterModelPreflightReason,
    options: { phase?: OpenRouterModelPhase; httpStatus?: number } = {},
  ) {
    super("The OpenRouter model catalog could not validate the active profile");
    this.name = "OpenRouterModelPreflightError";
    this.reason = reason;
    this.phase = options.phase;
    this.httpStatus = options.httpStatus;
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
    generativeModels: readonly {
      model: string;
      phase: Exclude<OpenRouterModelPhase, "transcription">;
    }[];
    transcriptionModel: string;
  }): Promise<void> {
    const [models, transcriptionModels] = await Promise.all([
      this.#loadModels(OPENROUTER_MODELS_URL),
      this.#loadModels(OPENROUTER_STT_MODELS_URL),
    ]);
    requireTranscriptionModel(transcriptionModels.get(input.transcriptionModel));
    for (const selection of input.generativeModels) {
      requireGenerativeModel(models.get(selection.model), selection.phase);
    }
  }

  async #loadModels(url: string): Promise<Map<string, z.infer<typeof modelSchema>>> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new OpenRouterModelPreflightError("catalog_unavailable");
    }
    if (!response.ok) {
      throw new OpenRouterModelPreflightError("catalog_unavailable", {
        httpStatus: response.status,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OpenRouterModelPreflightError("catalog_invalid");
    }
    const parsed = catalogSchema.safeParse(body);
    if (!parsed.success) throw new OpenRouterModelPreflightError("catalog_invalid");
    return new Map(parsed.data.data.map((model) => [model.id, model]));
  }
}

type CatalogModel = z.infer<typeof modelSchema>;

function requireTranscriptionModel(model: CatalogModel | undefined): void {
  if (model === undefined) {
    throw new OpenRouterModelPreflightError("model_missing", { phase: "transcription" });
  }
  const supportsAudio = model.architecture.input_modalities.includes("audio");
  const producesTranscription = model.architecture.output_modalities.includes("transcription");
  if (!supportsAudio || !producesTranscription) {
    throw new OpenRouterModelPreflightError("capability_missing", { phase: "transcription" });
  }
}

function requireGenerativeModel(
  model: CatalogModel | undefined,
  phase: Exclude<OpenRouterModelPhase, "transcription">,
): void {
  if (model === undefined) throw new OpenRouterModelPreflightError("model_missing", { phase });
  const acceptsText = model.architecture.input_modalities.includes("text");
  const producesText = model.architecture.output_modalities.includes("text");
  const producesJson = model.supported_parameters.includes("response_format");
  if (!acceptsText || !producesText || !producesJson) {
    throw new OpenRouterModelPreflightError("capability_missing", { phase });
  }
}
