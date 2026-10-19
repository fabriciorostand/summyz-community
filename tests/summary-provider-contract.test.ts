import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaSummaryProvider } from "../src/summary/ollama-summary-provider.js";
import { OpenRouterSummaryProvider } from "../src/summary/openrouter-summary-provider.js";

const summary = {
  decisions: [],
  discussedTopics: [],
  executiveSummary: "Planejamento",
  observations: [],
  labels: {
    assignee: "Responsável",
    assignees: "Responsáveis",
    deadline: "Prazo",
    decisions: "Decisões",
    discussedTopics: "Tópicos",
    executiveSummary: "Resumo executivo",
    meetingId: "ID",
    observations: "Observações",
    summary: "Resumo",
    tasks: "Tarefas",
    transcript: "Transcrição",
  },
  tasks: [
    { text: "Revisar juntos", ownerNames: ["Carla", "Diego"], sourceEntryIds: ["carla", "diego"] },
  ],
};
const entries = [
  { id: "carla", speaker: "Carla", text: "Eu reviso o layout.", startedAtMs: 0, endedAtMs: 1000 },
  {
    id: "diego",
    speaker: "Diego",
    text: "Eu reviso com você.",
    startedAtMs: 1000,
    endedAtMs: 2000,
  },
];

describe.each(["openrouter", "ollama"] as const)(
  "contrato de atribuições de %s",
  (providerName) => {
    it("usa o novo contrato na extração e leva a conversa completa à consolidação", async () => {
      const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
        Response.json({
          choices: [{ message: { content: JSON.stringify(summary) } }],
          message: { content: JSON.stringify(summary) },
        }),
      );
      const provider =
        providerName === "ollama"
          ? new OllamaSummaryProvider({ fetch, language: "pt-BR", model: "model", timeoutMs: 1000 })
          : new OpenRouterSummaryProvider({
              fetch,
              apiKey: "test-secret",
              language: "pt-BR",
              model: "model",
              timeoutMs: 1000,
              maxAttempts: 1,
              retryBaseMs: 1,
              retryMaxMs: 1,
            });
      expect((await provider.summarize(entries)).summary.tasks).toEqual(summary.tasks);
      expect((await provider.consolidate([summary], entries)).summary.tasks).toEqual(summary.tasks);
      const requestSchema = z.object({ messages: z.array(z.object({ content: z.string() })) });
      const extraction = requestSchema.parse(JSON.parse(String(fetch.mock.calls[0]?.[1].body)));
      const consolidation = requestSchema.parse(JSON.parse(String(fetch.mock.calls[1]?.[1].body)));
      expect(JSON.parse(consolidation.messages[1]?.content ?? "null")).toEqual({
        partialSummaries: [summary],
        transcriptEntries: entries,
      });
      expect(extraction.messages[0]?.content).toContain("first-person commitments");
      expect(consolidation.messages[0]?.content).toContain("provided transcriptEntries");
      expect(String(fetch.mock.calls[0]?.[1].body)).toContain('"ownerNames"');
      for (const call of fetch.mock.calls) {
        expect(String(call[1].body)).not.toContain('"fullTranscript"');
      }
    });
  },
);
