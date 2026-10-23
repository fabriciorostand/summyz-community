import { describe, expect, it, vi } from "vitest";

import {
  OpenRouterModelPreflight,
  OpenRouterModelPreflightError,
} from "../src/openrouter/model-preflight.js";

describe("preflight de modelos OpenRouter", () => {
  it("consulta o catálogo STT e valida áudio para transcrição com resposta detalhada", async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit) =>
      Response.json({
        data: url.includes("output_modalities=transcription")
          ? [
              {
                architecture: {
                  input_modalities: ["audio"],
                  output_modalities: ["transcription"],
                },
                id: "openai/whisper-large-v3",
                supported_parameters: ["response_format"],
              },
            ]
          : [
              {
                architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                id: "vendor/generative",
                supported_parameters: ["response_format"],
              },
            ],
      }),
    );
    const preflight = new OpenRouterModelPreflight({ apiKey: "secret", fetch });

    await expect(
      preflight.validate({
        generativeModels: [{ model: "vendor/generative", phase: "refinement" }],
        transcriptionModel: "openai/whisper-large-v3",
      }),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/models?output_modalities=transcription",
    ]);
  });

  it("aceita transcrição de áudio e geração estruturada sem inferir multilingual", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        data: [
          {
            architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
            id: "vendor/stt",
            supported_parameters: ["response_format"],
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
        generativeModels: [{ model: "vendor/generative", phase: "refinement" }],
        transcriptionModel: "vendor/stt",
      }),
    ).resolves.toBeUndefined();
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer secret" });
  });

  it("aceita Whisper quando o catálogo STT não declara response_format", async () => {
    const preflight = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async (url: string) =>
        Response.json({
          data: url.includes("output_modalities=transcription")
            ? [
                {
                  architecture: {
                    input_modalities: ["audio"],
                    output_modalities: ["transcription"],
                  },
                  id: "openai/whisper-large-v3",
                  supported_parameters: [],
                },
              ]
            : [
                {
                  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
                  id: "google/gemini-3.7-flash",
                  supported_parameters: ["response_format"],
                },
              ],
        }),
      ),
    });

    await expect(
      preflight.validate({
        generativeModels: [{ model: "google/gemini-3.7-flash", phase: "summary" }],
        transcriptionModel: "openai/whisper-large-v3",
      }),
    ).resolves.toBeUndefined();
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
              architecture: {
                input_modalities: ["audio"],
                output_modalities: ["transcription"],
              },
              id: "vendor/stt",
              supported_parameters: ["response_format"],
            },
            {
              architecture: {
                input_modalities: ["audio"],
                output_modalities: ["transcription"],
              },
              id: "vendor/stt-without-response-format",
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
      preflight.validate({
        generativeModels: generativeModels.map((model) => ({ model, phase: "summary" })),
        transcriptionModel,
      }),
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
    ).rejects.toMatchObject({ reason: "catalog_unavailable", httpStatus: 503 });
    await expect(
      invalid.validate({ generativeModels: [], transcriptionModel: "vendor/stt" }),
    ).rejects.toMatchObject({ reason: "catalog_invalid" });
  });

  it("distingue modelo ausente de modalidade incompatível", async () => {
    const preflight = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async () =>
        Response.json({
          data: [
            {
              architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
              id: "vendor/stt",
              supported_parameters: [],
            },
            {
              architecture: { input_modalities: ["text"], output_modalities: ["audio"] },
              id: "vendor/incompatible",
              supported_parameters: ["response_format"],
            },
          ],
        }),
      ),
    });

    await expect(
      preflight.validate({ generativeModels: [], transcriptionModel: "vendor/missing" }),
    ).rejects.toMatchObject({ reason: "model_missing", phase: "transcription" });
    await expect(
      preflight.validate({
        generativeModels: [{ model: "vendor/incompatible", phase: "summary" }],
        transcriptionModel: "vendor/stt",
      }),
    ).rejects.toMatchObject({ reason: "capability_missing", phase: "summary" });
  });

  it("não expõe a causa de uma falha de rede que contenha credenciais", async () => {
    const preflight = new OpenRouterModelPreflight({
      apiKey: "secret",
      fetch: vi.fn(async () => {
        throw new Error("Bearer secret");
      }),
    });

    await expect(
      preflight.validate({ generativeModels: [], transcriptionModel: "vendor/stt" }),
    ).rejects.toMatchObject({
      reason: "catalog_unavailable",
      message: expect.not.stringContaining("secret"),
    });
  });
});
