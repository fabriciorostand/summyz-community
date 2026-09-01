import { describe, expect, it, vi } from "vitest";

import {
  OpenRouterModelPreflight,
  OpenRouterModelPreflightError,
} from "../src/openrouter/model-preflight.js";

describe("preflight de modelos OpenRouter", () => {
  it("aceita transcrição de áudio e geração estruturada sem inferir multilingual", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        data: [
          {
            architecture: { input_modalities: ["audio"], output_modalities: ["text"] },
            id: "vendor/stt",
            supported_parameters: [],
          },
          {
            architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            id: "vendor/generative",
            supported_parameters: ["response_format", "structured_outputs"],
          },
        ],
      }),
    );
    const preflight = new OpenRouterModelPreflight({ apiKey: "secret", fetch });

    await expect(
      preflight.validate({
        generativeModels: ["vendor/generative"],
        transcriptionModel: "vendor/stt",
      }),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it.each([
    ["modelo ausente", ["vendor/missing"], "vendor/stt"],
    ["transcrição sem áudio", ["vendor/generative"], "vendor/generative"],
    ["geração sem resposta estruturada", ["vendor/stt"], "vendor/stt"],
  ])("bloqueia %s", async (_name, generativeModels, transcriptionModel) => {
    const preflight = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async () =>
        Response.json({
          data: [
            {
              architecture: { input_modalities: ["audio"], output_modalities: ["text"] },
              id: "vendor/stt",
              supported_parameters: [],
            },
            {
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              id: "vendor/generative",
              supported_parameters: [],
            },
          ],
        }),
      ),
    });

    await expect(
      preflight.validate({ generativeModels, transcriptionModel }),
    ).rejects.toBeInstanceOf(OpenRouterModelPreflightError);
  });

  it("falha fechado quando o catálogo está indisponível ou inválido", async () => {
    const unavailable = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async () => new Response("", { status: 503 })),
    });
    const invalid = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async () => Response.json({ data: [{ id: "model" }] })),
    });

    await expect(
      unavailable.validate({ generativeModels: [], transcriptionModel: "vendor/stt" }),
    ).rejects.toBeInstanceOf(OpenRouterModelPreflightError);
    await expect(
      invalid.validate({ generativeModels: [], transcriptionModel: "vendor/stt" }),
    ).rejects.toBeInstanceOf(OpenRouterModelPreflightError);
  });
});
