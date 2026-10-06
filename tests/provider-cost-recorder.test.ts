import { describe, expect, it, vi } from "vitest";

import type { CostAttempt, CostLedgerStore } from "../src/cost/cost-ledger.js";
import { ProviderCostRecorder } from "../src/cost/provider-cost-recorder.js";

function createStore() {
  const attempts: CostAttempt[] = [];
  const store: CostLedgerStore = {
    saveAttempt: vi.fn(async (attempt: CostAttempt) => {
      const index = attempts.findIndex((candidate) => candidate.attemptId === attempt.attemptId);
      if (index === -1) attempts.push(attempt);
      else attempts[index] = attempt;
    }),
    saveMeeting: vi.fn(async () => undefined),
  };
  return { attempts, store };
}

describe("ProviderCostRecorder", () => {
  it("persiste a tentativa antes da chamada e confirma o custo direto sem arredondar", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      store,
    });

    const reference = await recorder.beginApi("openrouter");
    expect(attempts[0]).toMatchObject({ outcome: "pending", financialStatus: "pending" });

    await recorder.finishOpenRouterResponse(reference, {
      body: {
        model: "google/gemini-2.5-flash",
        usage: { cost: 0.000000123456789 },
      },
      generationId: "gen-1",
      outcome: "success",
    });

    expect(attempts[0]).toMatchObject({
      confirmationSource: "response",
      cost: "0.000000123456789",
      currency: "USD",
      financialStatus: "confirmed",
      generationId: "gen-1",
      model: "google/gemini-2.5-flash",
      outcome: "success",
    });
  });

  it("prioriza o custo lexical exato da resposta sobre o number arredondado", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-exact",
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: { usage: { cost: 0.12345678901234568 } },
      exactCost: "0.123456789012345678",
      outcome: "success",
    });

    expect(attempts[0]?.cost).toBe("0.123456789012345678");
  });

  it("reconcilia pelo generation id quando a resposta não contém custo", async () => {
    const { attempts, store } = createStore();
    const fetch = vi.fn(async () =>
      Response.json({
        data: { id: "gen-1", model: "openai/gpt-4o-mini", total_cost: 0.00042 },
      }),
    );
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "refinement" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      openRouter: { apiKey: "secret-key", fetch },
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: { error: { code: 500 } },
      generationId: "gen-1",
      outcome: "failure",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/generation?id=gen-1",
      expect.objectContaining({ headers: { Authorization: "Bearer secret-key" } }),
    );
    expect(attempts[0]).toMatchObject({
      confirmationSource: "generation",
      cost: "0.00042",
      financialStatus: "confirmed",
      model: "openai/gpt-4o-mini",
      outcome: "failure",
    });
  });

  it("mantém reconciliação pendente quando a consulta falha e não inventa custo zero", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      openRouter: { apiKey: "secret-key", fetch: async () => new Response("", { status: 404 }) },
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: {},
      generationId: "gen-1",
      outcome: "failure",
    });

    expect(attempts[0]).toMatchObject({
      cost: null,
      currency: null,
      financialStatus: "pending",
      generationId: "gen-1",
      outcome: "failure",
    });
  });

  it("mantém pendente sem credencial de reconciliação e aceita custo sem identificador", async () => {
    const { attempts, store } = createStore();
    let id = 0;
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => `attempt-${String(++id)}`,
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      store,
    });
    const pendingReference = await recorder.beginApi("openrouter");
    await recorder.finishOpenRouterResponse(pendingReference, {
      body: {},
      generationId: "gen-1",
      outcome: "failure",
    });
    const confirmedReference = await recorder.beginApi("openrouter");
    await recorder.finishOpenRouterResponse(confirmedReference, {
      body: { model: "model-effective", usage: { cost: 1e-8 } },
      outcome: "success",
    });

    expect(attempts[0]).toMatchObject({ financialStatus: "pending", generationId: "gen-1" });
    expect(attempts[1]).toMatchObject({ cost: "0.00000001", financialStatus: "confirmed" });
  });

  it("não registra conteúdo nem credencial quando a reconciliação lança erro", async () => {
    const { attempts, store } = createStore();
    const warn = vi.fn();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      logger: { info: vi.fn(), warn } as never,
      openRouter: {
        apiKey: "secret-key",
        fetch: async () => {
          throw new Error("sensitive response");
        },
      },
      store,
    });
    const reference = await recorder.beginApi("openrouter");
    await recorder.finishOpenRouterResponse(reference, {
      body: { content: "private transcript" },
      generationId: "gen-1",
      outcome: "failure",
    });

    expect(attempts[0]).toMatchObject({ financialStatus: "pending" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-key");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private transcript");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive response");
  });

  it("marca perda total de resposta como não atribuível", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "transcription" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishUnattributed(reference, "failure");

    expect(attempts[0]).toMatchObject({
      cost: null,
      financialStatus: "unattributed",
      outcome: "failure",
    });
  });

  it("marca resposta sem custo e sem generation id como não atribuível", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: { model: "effective-model" },
      outcome: "failure",
    });

    expect(attempts[0]).toMatchObject({
      cost: null,
      financialStatus: "unattributed",
      model: null,
      outcome: "failure",
    });
  });

  it("usa identificador e relógio padrão e confirma custo mesmo sem modelo", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: { usage: { cost: 0.02 } },
      outcome: "success",
    });

    expect(reference.attemptId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(attempts[0]).toMatchObject({
      cost: "0.02",
      financialStatus: "confirmed",
      generationId: null,
      model: null,
    });
  });

  it("preserva o modelo conhecido enquanto a reconciliação permanece pendente", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => "attempt-1",
      openRouter: {
        apiKey: "secret-key",
        fetch: async () => new Response("", { status: 404 }),
      },
      store,
    });
    const reference = await recorder.beginApi("openrouter");

    await recorder.finishOpenRouterResponse(reference, {
      body: { model: "effective-model" },
      generationId: "gen-1",
      outcome: "failure",
    });

    expect(attempts[0]).toMatchObject({
      financialStatus: "pending",
      generationId: "gen-1",
      model: "effective-model",
    });
  });

  it("trata metadados externos inválidos e rejeições não Error sem expor conteúdo", async () => {
    const { attempts, store } = createStore();
    const warn = vi.fn();
    let id = 0;
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "summary" },
      id: () => `attempt-${String(++id)}`,
      logger: { info: vi.fn(), warn } as never,
      openRouter: {
        apiKey: "secret-key",
        fetch: async () => Promise.reject("private provider response"),
      },
      store,
    });
    const invalidReference = await recorder.beginApi("openrouter");
    await recorder.finishOpenRouterResponse(invalidReference, {
      body: null,
      outcome: "failure",
    });
    const rejectedReference = await recorder.beginApi("openrouter");
    await recorder.finishOpenRouterResponse(rejectedReference, {
      body: {},
      generationId: "gen-1",
      outcome: "failure",
    });

    expect(attempts[0]).toMatchObject({ financialStatus: "unattributed" });
    expect(attempts[1]).toMatchObject({ financialStatus: "pending" });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorType: "string" }),
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private provider response");
  });

  it("registra execução local com modelo e custo não aplicável", async () => {
    const { attempts, store } = createStore();
    const recorder = new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase: "refinement" },
      id: () => "attempt-1",
      now: () => new Date("2026-08-24T11:31:00.000Z"),
      store,
    });
    const reference = await recorder.beginLocal("ollama", "qwen2.5:3b");
    await recorder.finishLocal(reference, "success");

    expect(attempts[0]).toMatchObject({
      cost: null,
      currency: null,
      execution: "local",
      financialStatus: "not_applicable",
      model: "qwen2.5:3b",
      outcome: "success",
    });
  });
});
