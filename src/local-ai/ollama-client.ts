import { z } from "zod";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const responseSchema = z.object({
  message: z.object({ content: z.string().min(1) }),
});

export interface OllamaStructuredRequestOptions<T> {
  baseUrl?: string;
  fetch?: Fetch;
  generation?: {
    seed?: number | undefined;
    temperature?: number | undefined;
    think?: boolean | undefined;
  };
  input: unknown;
  instruction: string;
  jsonSchema: Readonly<Record<string, unknown>>;
  model: string;
  onIncompatibleModel?: (model: string) => Promise<void>;
  outputSchema: z.ZodType<T>;
  timeoutMs: number;
}

export class OllamaRequestError extends Error {
  public readonly status: number | undefined;

  public constructor(status?: number) {
    super("The Ollama request failed");
    this.name = "OllamaRequestError";
    this.status = status;
  }
}

export class IncompatibleOllamaModelError extends Error {
  public constructor() {
    super("The Ollama model did not satisfy the required structured output contract");
    this.name = "IncompatibleOllamaModelError";
  }
}

export async function requestOllamaStructured<T>(
  options: OllamaStructuredRequestOptions<T>,
): Promise<T> {
  const generationOptions = {
    ...(options.generation?.seed === undefined ? {} : { seed: options.generation.seed }),
    ...(options.generation?.temperature === undefined
      ? {}
      : { temperature: options.generation.temperature }),
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `${options.baseUrl ?? "http://ollama:11434"}/api/chat`,
      {
        body: JSON.stringify({
          format: options.jsonSchema,
          keep_alive: "10m",
          messages: [
            { content: options.instruction, role: "system" },
            { content: JSON.stringify(options.input), role: "user" },
          ],
          model: options.model,
          ...(Object.keys(generationOptions).length === 0 ? {} : { options: generationOptions }),
          stream: false,
          ...(options.generation?.think === undefined ? {} : { think: options.generation.think }),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(options.timeoutMs),
      },
    );
  } catch {
    throw new OllamaRequestError();
  }
  if (!response.ok) {
    throw new OllamaRequestError(response.status);
  }

  try {
    const body: unknown = await response.json();
    const content = responseSchema.parse(body).message.content;
    const parsedContent: unknown = JSON.parse(content);
    return options.outputSchema.parse(parsedContent);
  } catch {
    await options.onIncompatibleModel?.(options.model);
    throw new IncompatibleOllamaModelError();
  }
}
