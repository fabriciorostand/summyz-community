import { describe, expect, it, vi } from "vitest";

import type { CostAttempt, CostLedgerStore, CostPhase } from "../src/cost/cost-ledger.js";
import { ProviderCostRecorder } from "../src/cost/provider-cost-recorder.js";
import { OllamaRefinementProvider } from "../src/refinement/ollama-refinement-provider.js";
import { OpenRouterRefinementProvider } from "../src/refinement/openrouter-refinement-provider.js";
import { OllamaSummaryProvider } from "../src/summary/ollama-summary-provider.js";
import { OpenRouterTranscriptionProvider } from "../src/transcription/openrouter-transcription-provider.js";

function createRecorder(phase: CostPhase) {
  const attempts: CostAttempt[] = [];
  const store: CostLedgerStore = {
    getMeeting: async () => undefined,
    listMeetings: async () => [],
    saveAttempt: vi.fn(async (attempt) => {
      const index = attempts.findIndex((item) => item.attemptId === attempt.attemptId);
      if (index === -1) attempts.push(attempt);
      else attempts[index] = attempt;
    }),
    saveMeeting: vi.fn(async () => undefined),
  };
  return {
    attempts,
    recorder: new ProviderCostRecorder({
      context: { guildId: "guild-1", meetingId: "meeting-1", phase },
      id: () => `attempt-${String(attempts.length + 1)}`,
      store,
    }),
  };
}

describe("provider cost integration", () => {
  it("registra custo e modelo efetivo da transcrição OpenRouter", async () => {
    const context = createRecorder("transcription");
    const provider = new OpenRouterTranscriptionProvider({
      apiKey: "secret",
      costRecorder: context.recorder,
      fetch: async () =>
        Response.json(
          {
            model: "openai/whisper-1",
            text: "Olá.",
            usage: { cost: 0.0005 },
            words: [{ end: 1, start: 0, word: "Olá." }],
          },
          { headers: { "x-generation-id": "gen-transcription" } },
        ),
      maxAttempts: 1,
      model: "openrouter/auto",
      profile: { interSpeechSilenceMs: 0, temperature: 0 },
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });

    await provider.transcribe({ audio: Buffer.from("audio"), format: "wav" });

    expect(context.attempts[0]).toMatchObject({
      cost: "0.0005",
      generationId: "gen-transcription",
      model: "openai/whisper-1",
      outcome: "success",
    });
  });

  it("registra custo de resposta incompatível no refinamento OpenRouter", async () => {
    const context = createRecorder("refinement");
    const provider = new OpenRouterRefinementProvider({
      apiKey: "secret",
      costRecorder: context.recorder,
      fetch: async () =>
        Response.json({
          choices: [],
          model: "google/gemini-2.5-flash",
          usage: { cost: 0.0007 },
        }),
      maxAttempts: 1,
      model: "openrouter/auto",
      retryBaseMs: 1,
      retryMaxMs: 1,
      timeoutMs: 1_000,
    });

    await expect(provider.refine([])).rejects.toBeDefined();

    expect(context.attempts[0]).toMatchObject({
      cost: "0.0007",
      financialStatus: "confirmed",
      model: "google/gemini-2.5-flash",
      outcome: "failure",
    });
  });

  it("finaliza o custo e classifica timeout durante a leitura do refinamento", async () => {
    const context = createRecorder("refinement");
    const response = Response.json({ choices: [] });
    vi.spyOn(response, "text").mockRejectedValue(
      Object.assign(new Error("response body timed out"), { name: "TimeoutError" }),
    );
    const fetch = vi.fn(async () => response);
    const provider = new OpenRouterRefinementProvider({
      apiKey: "secret",
      costRecorder: context.recorder,
      fetch,
      maxAttempts: 3,
      model: "openrouter/auto",
      retryBaseMs: 1,
      retryMaxMs: 1,
      sleep: vi.fn(async () => undefined),
      timeoutMs: 1_000,
    });

    await expect(provider.refine([])).rejects.toMatchObject({
      attempts: 1,
      cause: expect.objectContaining({ timedOut: true }),
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(context.attempts[0]).toMatchObject({
      endedAt: expect.any(String),
      financialStatus: "unattributed",
      outcome: "failure",
    });
  });

  it("registra modelos locais usados por refinamento e resumo sem custo", async () => {
    const refinement = createRecorder("refinement");
    const refinementProvider = new OllamaRefinementProvider({
      costRecorder: refinement.recorder,
      fetch: async () =>
        Response.json({
          message: { content: JSON.stringify({ blocks: [{ id: "id-1", text: "Olá" }] }) },
        }),
      model: "qwen-refinement",
      timeoutMs: 1_000,
    });
    await refinementProvider.refine([
      { endedAtMs: 1, id: "id-1", speaker: "A", startedAtMs: 0, text: "Ola" },
    ]);

    const summary = createRecorder("summary");
    const summaryProvider = new OllamaSummaryProvider({
      costRecorder: summary.recorder,
      fetch: async () =>
        Response.json({
          message: {
            content: JSON.stringify({
              decisions: [],
              discussedTopics: [],
              executiveSummary: "Resumo",
              observations: [],
              tasks: [],
            }),
          },
        }),
      language: "pt-BR",
      model: "qwen-summary",
      timeoutMs: 1_000,
    });
    await summaryProvider.summarize([]);

    expect(refinement.attempts[0]).toMatchObject({
      cost: null,
      financialStatus: "not_applicable",
      model: "qwen-refinement",
    });
    expect(summary.attempts[0]).toMatchObject({
      cost: null,
      financialStatus: "not_applicable",
      model: "qwen-summary",
    });
  });
});
