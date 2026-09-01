import { describe, expect, it, vi } from "vitest";

import type { CostAttempt, CostLedgerStore, CostPhase } from "../src/cost/cost-ledger.js";
import { ProviderCostRecorder } from "../src/cost/provider-cost-recorder.js";
import { OllamaSummaryTranslator } from "../src/translation/ollama-summary-translator.js";
import { OpenRouterSummaryTranslator } from "../src/translation/openrouter-summary-translator.js";
import { TranslationRequestError } from "../src/translation/summary-translation.js";

const summary = {
  decisions: ["Decision"],
  discussedTopics: ["Topic"],
  executiveSummary: "Summary",
  labels: {
    assignee: "Assignee",
    deadline: "Deadline",
    decisions: "Decisions",
    discussedTopics: "Discussed topics",
    executiveSummary: "Executive summary",
    fullTranscript: "Full transcript",
    meetingId: "Meeting ID",
    observations: "Observations",
    summary: "Summary",
    tasks: "Tasks",
    transcript: "Transcript",
  },
  observations: [],
  tasks: [{ ownerName: "⟦SUMMYZ_PROTECTED_0001⟧", text: "Task" }],
};

function createCostRecorder(phase: CostPhase) {
  const attempts: CostAttempt[] = [];
  const store: CostLedgerStore = {
    getMeeting: async () => undefined,
    listMeetings: async () => [],
    saveAttempt: async (attempt) => {
      const index = attempts.findIndex((item) => item.attemptId === attempt.attemptId);
      if (index === -1) attempts.push(attempt);
      else attempts[index] = attempt;
    },
    saveMeeting: async () => undefined,
  };
  return {
    attempts,
    recorder: new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase },
      id: () => "attempt-1",
      store,
    }),
  };
}

describe("adaptadores de tradução", () => {
  it("isola OpenRouter com saída estruturada e prompt protegido", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request.response_format.json_schema.strict).toBe(true);
      expect(request.messages[0].content).toContain("es-MX");
      return Response.json({ choices: [{ message: { content: JSON.stringify(summary) } }] });
    });
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      fetch,
      model: "vendor/model",
      timeoutMs: 1_000,
    });
    await expect(translator.translate(summary, "es-MX")).resolves.toEqual(summary);
  });

  it("isola Ollama com o mesmo contrato estrutural", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request.format.required).toContain("executiveSummary");
      expect(request.messages[0].content).toContain("fr");
      return Response.json({ message: { content: JSON.stringify(summary) } });
    });
    const translator = new OllamaSummaryTranslator({
      fetch,
      model: "qwen",
      timeoutMs: 1_000,
    });
    await expect(translator.translate(summary, "fr")).resolves.toEqual(summary);
  });

  it("encaminha opções próprias e registra sucesso da tradução OpenRouter", async () => {
    const costs = createCostRecorder("translation");
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({ seed: 7, temperature: 0.2 });
      expect(request.messages[0].content).toContain("Prefer formal wording");
      return Response.json(
        {
          choices: [{ message: { content: JSON.stringify(summary) } }],
          model: "vendor/effective",
          usage: { cost: 0.002 },
        },
        { headers: { "x-generation-id": "generation-1" } },
      );
    });
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      costRecorder: costs.recorder,
      fetch,
      generation: { seed: 7, temperature: 0.2 },
      model: "vendor/model",
      prompt: "Prefer formal wording",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "de")).resolves.toEqual(summary);
    expect(costs.attempts[0]).toMatchObject({
      cost: "0.002",
      generationId: "generation-1",
      model: "vendor/effective",
      outcome: "success",
    });
  });

  it.each([
    [400, false],
    [408, true],
    [429, true],
    [503, true],
  ])("classifica status OpenRouter %i sem expor a resposta", async (status, retryable) => {
    const costs = createCostRecorder("translation");
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      costRecorder: costs.recorder,
      fetch: vi.fn(async () =>
        Response.json(
          { error: { message: "sensitive response" }, usage: { cost: 0.003 } },
          { status },
        ),
      ),
      model: "vendor/model",
      timeoutMs: 1_000,
    });

    const error = await translator.translate(summary, "it").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TranslationRequestError);
    expect(error).toMatchObject({ retryable });
    expect(String(error)).not.toContain("sensitive response");
    expect(costs.attempts[0]).toMatchObject({ outcome: "failure" });
  });

  it("registra falha sem atribuição quando a rede OpenRouter falha", async () => {
    const costs = createCostRecorder("translation");
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      costRecorder: costs.recorder,
      fetch: vi.fn(async () => {
        throw new Error("sensitive network error");
      }),
      model: "vendor/model",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "it")).rejects.toMatchObject({ retryable: true });
    expect(costs.attempts[0]).toMatchObject({
      financialStatus: "unattributed",
      outcome: "failure",
    });
  });

  it("rejeita e contabiliza uma resposta OpenRouter estruturalmente inválida", async () => {
    const costs = createCostRecorder("translation");
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      costRecorder: costs.recorder,
      fetch: vi.fn(async () => Response.json({ choices: [] })),
      model: "vendor/model",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "it")).rejects.toThrow(/structure/i);
    expect(costs.attempts[0]).toMatchObject({ outcome: "failure" });
  });

  it("rejeita JSON interno inválido sem depender do registrador de custo", async () => {
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      fetch: vi.fn(async () => Response.json({ choices: [{ message: { content: "not-json" } }] })),
      model: "vendor/model",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "it")).rejects.toThrow(/structure/i);
  });

  it("classifica erro HTTP sem registrador de custo", async () => {
    const translator = new OpenRouterSummaryTranslator({
      apiKey: "secret",
      fetch: vi.fn(async () => new Response("", { status: 400 })),
      model: "vendor/model",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "it")).rejects.toMatchObject({ retryable: false });
  });

  it("propaga uma falha de rede Ollama sem registrador de custo", async () => {
    const translator = new OllamaSummaryTranslator({
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
      model: "qwen",
      timeoutMs: 1_000,
    });

    await expect(translator.translate(summary, "fr")).rejects.toBeDefined();
  });

  it("encaminha opções próprias e contabiliza sucesso e falha local", async () => {
    const successfulCosts = createCostRecorder("translation");
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://custom-ollama:11434/api/chat");
      expect(JSON.parse(String(init.body))).toMatchObject({
        options: { seed: 11, temperature: 0.1 },
        think: true,
      });
      return Response.json({ message: { content: JSON.stringify(summary) } });
    });
    const successful = new OllamaSummaryTranslator({
      baseUrl: "http://custom-ollama:11434",
      costRecorder: successfulCosts.recorder,
      fetch,
      generation: { seed: 11, temperature: 0.1, think: true },
      model: "qwen",
      prompt: "Formal",
      timeoutMs: 1_000,
    });
    await expect(successful.translate(summary, "fr")).resolves.toEqual(summary);
    expect(successfulCosts.attempts[0]).toMatchObject({
      financialStatus: "not_applicable",
      outcome: "success",
    });

    const failedCosts = createCostRecorder("translation");
    const failed = new OllamaSummaryTranslator({
      costRecorder: failedCosts.recorder,
      fetch: vi.fn(async () => new Response("", { status: 500 })),
      model: "qwen",
      timeoutMs: 1_000,
    });
    await expect(failed.translate(summary, "fr")).rejects.toBeDefined();
    expect(failedCosts.attempts[0]).toMatchObject({ outcome: "failure" });
  });
});
