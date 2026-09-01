import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { OpenRouterRefinementProvider } from "../src/refinement/openrouter-refinement-provider.js";

const entries = [
  {
    endedAtMs: 2_000,
    id: "segment-1:000000",
    speaker: "Fab",
    startedAtMs: 1_000,
    text: "conditivite",
  },
];

function successResponse(id = "segment-1:000000"): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify({ blocks: [{ id, text: "conjuntivite" }] }) } },
      ],
    }),
    { status: 200 },
  );
}

describe("OpenRouterRefinementProvider", () => {
  it("subordina o prompt configurado e mantém o prompt-base em Sem prompt", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    const configured = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 1,
      model: "model",
      prompt: "Prompt personalizado completo.",
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });
    await configured.refine(entries);
    const configuredBody = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as {
      messages: { content: string; role: string }[];
    };
    expect(configuredBody.messages[0]).toMatchObject({ role: "system" });
    expect(configuredBody.messages[0]?.content).toContain("<editable-profile-prompt>");
    expect(configuredBody.messages[0]?.content).toContain("Prompt personalizado completo.");

    const withoutPrompt = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 1,
      model: "model",
      prompt: null,
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });
    await withoutPrompt.refine(entries);
    const bodyWithoutPrompt = JSON.parse(String(fetch.mock.calls[1]?.[1].body)) as {
      messages: { role: string }[];
    };
    expect(bodyWithoutPrompt.messages).toHaveLength(2);
    expect(bodyWithoutPrompt.messages[0]?.role).toBe("system");
    expect(JSON.stringify(bodyWithoutPrompt)).not.toContain("<editable-profile-prompt>");
  });

  it("solicita somente id e texto e preserva os metadados no código", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      timeoutMs: 120_000,
    });

    await expect(provider.refine(entries)).resolves.toEqual({
      attempts: 1,
      entries: [{ ...entries[0], text: "conjuntivite" }],
    });
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "google/gemini-3.7-flash",
      provider: { require_parameters: true },
      response_format: { json_schema: { name: "transcript_refinement", strict: true } },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("seed");
    expect(JSON.stringify(body)).not.toContain("keywords");
    expect(JSON.stringify(body)).toContain("original language");
    expect(JSON.stringify(body)).not.toContain("português brasileiro");
  });

  it("retenta resposta que altera ids e não registra texto ou segredo", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(successResponse("outro-id"))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn(async () => undefined);
    const logger = createLogger("silent");
    const warn = vi.spyOn(logger, "warn");
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      logger,
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 10,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.refine(entries)).resolves.toMatchObject({ attempts: 2 });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("conditivite");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("segredo");
  });

  it("esgota exatamente três tentativas em falhas transitórias", async () => {
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch: vi.fn(async () => new Response("", { status: 503 })),
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 10,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.refine(entries)).rejects.toMatchObject({ attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("respeita Retry-After e não retenta erro de autenticação", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn(async (_url: string, _init: RequestInit) => successResponse())
      .mockResolvedValueOnce(new Response("", { headers: { "retry-after": "2" }, status: 429 }))
      .mockResolvedValueOnce(successResponse());
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });
    await expect(provider.refine(entries)).resolves.toMatchObject({ attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(2_000);

    const unauthorized = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch: vi.fn(async () => new Response("", { status: 401 })),
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });
    await expect(unauthorized.refine(entries)).rejects.toMatchObject({ attempts: 1 });
  });

  it("retenta uma falha de rede sem expor sua causa", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("conteúdo sensível"))
      .mockResolvedValueOnce(successResponse());
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 10,
      sleep: vi.fn(async () => undefined),
      timeoutMs: 120_000,
    });
    await expect(provider.refine(entries)).resolves.toMatchObject({ attempts: 2 });
  });

  it("retenta resposta vazia e limita o jitter ao teto configurado", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { headers: { "retry-after": "60" }, status: 429 }))
      .mockResolvedValueOnce(successResponse());
    const provider = new OpenRouterRefinementProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 3,
      model: "google/gemini-3.7-flash",
      random: () => 1,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.refine(entries)).resolves.toMatchObject({ attempts: 3 });
    expect(sleep).toHaveBeenNthCalledWith(1, 1_250);
    expect(sleep).toHaveBeenNthCalledWith(2, 30_000);
  });
});
