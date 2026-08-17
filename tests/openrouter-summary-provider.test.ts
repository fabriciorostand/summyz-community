import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { OpenRouterSummaryProvider } from "../src/summary/openrouter-summary-provider.js";
import type { SummaryTranscriptEntry } from "../src/summary/summary-result.js";

const entries: SummaryTranscriptEntry[] = [
  {
    endedAtMs: 12_000,
    id: "segment-a:000000",
    speaker: "Ana",
    startedAtMs: 10_000,
    text: "Bruno, envie o orçamento até sexta-feira.",
  },
];

function successResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              decisions: [],
              discussedTopics: ["Orçamento"],
              executiveSummary: "A equipe discutiu o orçamento.",
              observations: [],
              tasks: [
                {
                  deadlineText: "até sexta-feira",
                  ownerName: "Bruno",
                  sourceEntryIds: ["segment-a:000000"],
                  text: "Enviar o orçamento.",
                },
              ],
            }),
          },
        },
      ],
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

describe("OpenRouterSummaryProvider", () => {
  it("solicita saída estruturada e envia a transcrição como dados não confiáveis", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      timeoutMs: 120_000,
    });

    await expect(provider.summarize(entries)).resolves.toMatchObject({
      attempts: 1,
      summary: { executiveSummary: "A equipe discutiu o orçamento." },
    });

    const init = fetch.mock.calls[0]?.[1];
    const body: unknown = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "google/gemini-3.7-flash",
      provider: { require_parameters: true },
      response_format: {
        json_schema: { name: "meeting_summary", strict: true },
        type: "json_schema",
      },
      stream: false,
      temperature: 0,
    });
    expect(JSON.stringify(body)).toContain("segment-a:000000");
    expect(JSON.stringify(body)).toContain("não confiáveis");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer segredo" });
  });

  it("retenta falhas transitórias, respeita Retry-After e não retenta credencial inválida", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn(async (_url: string, _init: RequestInit) => successResponse())
      .mockResolvedValueOnce(new Response("", { headers: { "retry-after": "2" }, status: 429 }))
      .mockResolvedValueOnce(successResponse());
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.summarize(entries)).resolves.toMatchObject({ attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(2_000);

    const unauthorized = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch: vi.fn(async () => new Response("", { status: 401 })),
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });
    await expect(unauthorized.summarize(entries)).rejects.toMatchObject({ attempts: 1 });
  });

  it("mantém o jitter dentro do limite máximo de retry", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn(async (_url: string, _init: RequestInit) => successResponse())
      .mockResolvedValueOnce(new Response("", { headers: { "retry-after": "60" }, status: 429 }))
      .mockResolvedValueOnce(successResponse());
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch,
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      random: () => 1,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.summarize(entries)).resolves.toMatchObject({ attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("retenta resposta vazia ou incompatível sem registrar conteúdo sensível", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
      .mockResolvedValueOnce(successResponse());
    const sleep = vi.fn(async () => undefined);
    const logger = createLogger("silent");
    const warn = vi.spyOn(logger, "warn");
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch,
      logger,
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 10,
      sleep,
      timeoutMs: 120_000,
    });

    await expect(provider.summarize(entries)).resolves.toMatchObject({ attempts: 2 });
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("orçamento");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("segredo");
  });

  it("esgota tentativas após falhas de rede e informa a quantidade sem vazar a causa", async () => {
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch: vi.fn(async () => {
        throw new Error("resposta com conteúdo sensível");
      }),
      maxAttempts: 2,
      model: "google/gemini-3.7-flash",
      random: () => 0,
      retryBaseMs: 1,
      retryMaxMs: 10,
      sleep,
      timeoutMs: 120_000,
    });

    const operation = provider.summarize(entries);
    await expect(operation).rejects.toMatchObject({ attempts: 2 });
    await expect(operation).rejects.not.toThrow(/conteúdo sensível/);
    expect(sleep).toHaveBeenCalledOnce();
  });
});
