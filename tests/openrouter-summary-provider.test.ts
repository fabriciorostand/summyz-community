import { describe, expect, it, vi } from "vitest";
import type { CostAttempt, CostLedgerStore } from "../src/cost/cost-ledger.js";
import { ProviderCostRecorder } from "../src/cost/provider-cost-recorder.js";
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

const labels = {
  assignee: "Responsável",
  deadline: "Prazo",
  decisions: "Decisões",
  discussedTopics: "Tópicos discutidos",
  executiveSummary: "Resumo executivo",
  fullTranscript: "Transcrição completa",
  meetingId: "ID da reunião",
  observations: "Observações",
  summary: "Resumo",
  tasks: "Tarefas",
  transcript: "Transcrição",
};

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
              labels,
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
  it("usa prompts distintos para extração e consolidação e permite desativá-los", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      consolidationPrompt: "Consolidação personalizada.",
      extractionPrompt: "Extração personalizada.",
      fetch,
      maxAttempts: 1,
      model: "model",
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });

    await provider.summarize(entries);
    await provider.consolidate([]);
    expect(String(fetch.mock.calls[0]?.[1].body)).toContain("Extração personalizada.");
    expect(String(fetch.mock.calls[1]?.[1].body)).toContain("Consolidação personalizada.");

    const withoutPrompts = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      consolidationPrompt: null,
      extractionPrompt: null,
      fetch,
      maxAttempts: 1,
      model: "model",
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });
    await withoutPrompts.summarize(entries);
    const body = JSON.parse(String(fetch.mock.calls[2]?.[1].body)) as {
      messages: { role: string }[];
    };
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]?.role).toBe("user");
  });

  it("registra custo, modelo efetivo e generation id antes de concluir a tentativa", async () => {
    const attempts: CostAttempt[] = [];
    const store: CostLedgerStore = {
      saveAttempt: vi.fn(async (attempt) => {
        const index = attempts.findIndex((item) => item.attemptId === attempt.attemptId);
        if (index === -1) attempts.push(attempt);
        else attempts[index] = attempt;
      }),
      saveMeeting: vi.fn(async () => undefined),
    };
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      store,
    });
    const responseBody = await successResponse().json();
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      costRecorder: recorder,
      fetch: async () =>
        Response.json(
          { ...responseBody, model: "google/gemini-2.5-flash", usage: { cost: 0.0000007 } },
          { headers: { "x-generation-id": "gen-1" } },
        ),
      maxAttempts: 4,
      model: "openrouter/auto",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      timeoutMs: 120_000,
    });

    await provider.summarize(entries);

    expect(attempts).toEqual([
      expect.objectContaining({
        cost: "0.0000007",
        generationId: "gen-1",
        model: "google/gemini-2.5-flash",
        outcome: "success",
      }),
    ]);
  });

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
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "google/gemini-3.7-flash",
      provider: { require_parameters: true },
      response_format: {
        json_schema: { name: "meeting_summary", strict: true },
        type: "json_schema",
      },
      stream: false,
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("seed");
    expect(JSON.stringify(body)).toContain("segment-a:000000");
    expect(JSON.stringify(body)).toContain("untrusted data");
    expect(JSON.stringify(body)).toContain("predominant language");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer segredo" });
  });

  it("instrui um idioma de saída explícito quando configurado", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => successResponse());
    const provider = new OpenRouterSummaryProvider({
      apiKey: "segredo",
      fetch,
      language: "es",
      maxAttempts: 4,
      model: "google/gemini-3.7-flash",
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      timeoutMs: 120_000,
    });

    await provider.summarize([]);

    expect(String(fetch.mock.calls[0]?.[1].body)).toContain("BCP 47 code es");
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
