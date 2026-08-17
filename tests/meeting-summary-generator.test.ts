import { describe, expect, it, vi } from "vitest";

import { MeetingSummaryGenerator } from "../src/summary/meeting-summary-generator.js";
import {
  type SummaryProvider,
  SummaryProviderFailureError,
} from "../src/summary/openrouter-summary-provider.js";
import type { SummaryDraft, SummaryTranscriptEntry } from "../src/summary/summary-result.js";

function draft(input: Partial<SummaryDraft> = {}): SummaryDraft {
  return {
    decisions: [],
    discussedTopics: [],
    executiveSummary: "Resumo parcial.",
    observations: [],
    tasks: [],
    ...input,
  };
}

const entries: SummaryTranscriptEntry[] = [
  {
    endedAtMs: 1_000,
    id: "entry-1",
    speaker: "Ana",
    startedAtMs: 0,
    text: "Está decidido: adotaremos o fluxo A.",
  },
  {
    endedAtMs: 3_000,
    id: "entry-2",
    speaker: "Bruno",
    startedAtMs: 2_000,
    text: "Ana, envie o documento amanhã.",
  },
];

describe("MeetingSummaryGenerator", () => {
  it("rejeita limite inválido e ainda resume uma transcrição vazia", async () => {
    const summarize = vi.fn(async () => ({ attempts: 1, summary: draft() }));
    const provider: SummaryProvider = {
      consolidate: vi.fn(async () => ({ attempts: 1, summary: draft() })),
      summarize,
    };

    expect(() => new MeetingSummaryGenerator({ maxChunkCharacters: 0, provider })).toThrow(
      /limite/i,
    );
    const generator = new MeetingSummaryGenerator({ maxChunkCharacters: 10, provider });
    await generator.generate([]);
    expect(summarize).toHaveBeenCalledWith([]);
  });

  it("resume em uma chamada quando a transcrição cabe no limite", async () => {
    const summarize = vi.fn(async () => ({ attempts: 1, summary: draft() }));
    const consolidate = vi.fn(async () => ({ attempts: 1, summary: draft() }));
    const provider: SummaryProvider = { consolidate, summarize };
    const generator = new MeetingSummaryGenerator({ maxChunkCharacters: 10_000, provider });

    await expect(generator.generate(entries)).resolves.toMatchObject({ attempts: 1 });
    expect(summarize).toHaveBeenCalledWith(entries);
    expect(consolidate).not.toHaveBeenCalled();
  });

  it("divide somente entre falas e consolida transcrições longas", async () => {
    const summarize = vi
      .fn()
      .mockResolvedValueOnce({
        attempts: 1,
        summary: draft({
          decisions: [{ sourceEntryIds: ["entry-1"], text: "Adotar o fluxo A." }],
        }),
      })
      .mockResolvedValueOnce({
        attempts: 2,
        summary: draft({
          tasks: [
            {
              deadlineText: "amanhã",
              ownerName: "Ana",
              sourceEntryIds: ["entry-2"],
              text: "Enviar o documento.",
            },
          ],
        }),
      });
    const consolidated = draft({
      decisions: [{ sourceEntryIds: ["entry-1"], text: "Adotar o fluxo A." }],
      tasks: [
        {
          deadlineText: "amanhã",
          ownerName: "Ana",
          sourceEntryIds: ["entry-2"],
          text: "Enviar o documento.",
        },
      ],
    });
    const consolidate = vi.fn(async () => ({ attempts: 1, summary: consolidated }));
    const provider: SummaryProvider = { consolidate, summarize };
    const generator = new MeetingSummaryGenerator({ maxChunkCharacters: 1, provider });

    await expect(generator.generate(entries)).resolves.toEqual({
      attempts: 4,
      summary: consolidated,
    });
    expect(summarize).toHaveBeenNthCalledWith(1, [entries[0]]);
    expect(summarize).toHaveBeenNthCalledWith(2, [entries[1]]);
    expect(consolidate).toHaveBeenCalledOnce();
  });

  it("aplica novamente a validação de origem depois da consolidação", async () => {
    const provider: SummaryProvider = {
      consolidate: vi.fn(async () => ({ attempts: 1, summary: draft() })),
      summarize: vi.fn(async () => ({
        attempts: 1,
        summary: draft({
          decisions: [{ sourceEntryIds: ["inventado"], text: "Decisão inventada." }],
          tasks: [
            {
              deadlineText: "sexta-feira",
              ownerName: "Carlos",
              sourceEntryIds: ["entry-2"],
              text: "Enviar o documento.",
            },
          ],
        }),
      })),
    };
    const generator = new MeetingSummaryGenerator({ maxChunkCharacters: 10_000, provider });

    const result = await generator.generate(entries);

    expect(result.summary.decisions).toEqual([]);
    expect(result.summary.tasks).toEqual([
      { sourceEntryIds: ["entry-2"], text: "Enviar o documento." },
    ]);
  });

  it("preserva o total de tentativas quando um lote ou a consolidação falha", async () => {
    const firstFailure = new SummaryProviderFailureError(3, new Error("falha"));
    const providerWithFailedChunk: SummaryProvider = {
      consolidate: vi.fn(async () => ({ attempts: 1, summary: draft() })),
      summarize: vi.fn(async () => {
        throw firstFailure;
      }),
    };
    const oneChunk = new MeetingSummaryGenerator({
      maxChunkCharacters: 10_000,
      provider: providerWithFailedChunk,
    });
    await expect(oneChunk.generate(entries)).rejects.toMatchObject({ attempts: 3 });

    const providerWithFailedConsolidation: SummaryProvider = {
      consolidate: vi.fn(async () => {
        throw new SummaryProviderFailureError(2, new Error("falha"));
      }),
      summarize: vi.fn(async () => ({ attempts: 1, summary: draft() })),
    };
    const multipleChunks = new MeetingSummaryGenerator({
      maxChunkCharacters: 1,
      provider: providerWithFailedConsolidation,
    });
    await expect(multipleChunks.generate(entries)).rejects.toMatchObject({ attempts: 4 });
  });
});
