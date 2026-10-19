import { describe, expect, it } from "vitest";
import { MeetingSummaryGenerator } from "../../src/summary/meeting-summary-generator.js";
import { OllamaSummaryProvider } from "../../src/summary/ollama-summary-provider.js";

describe("atribuições e prazos com modelo local real", () => {
  it("reconhece compromissos em primeira pessoa, responsáveis compartilhados e datas relativas", async () => {
    const provider = new OllamaSummaryProvider({
      baseUrl: process.env.OLLAMA_SMOKE_URL ?? "http://ollama:11434",
      model: process.env.SMOKE_OLLAMA_MODEL ?? "qwen3:1.7b",
      language: "pt-BR",
      timeoutMs: 180_000,
      generation: { temperature: 0, seed: 0 },
    });
    const entries = [
      {
        id: "bruno",
        speaker: "Bruno",
        text: "Eu vou implementar a exportação em PDF até quarta-feira.",
      },
      {
        id: "carla",
        speaker: "Carla",
        text: "Eu e o Diego vamos revisar juntos o layout do PDF amanhã.",
      },
      {
        id: "diego",
        speaker: "Diego",
        text: "Confirmo, eu e a Carla vamos revisar juntos o layout amanhã.",
      },
    ].map((entry, index) => ({
      ...entry,
      startedAtMs: index * 1000,
      endedAtMs: (index + 1) * 1000,
      spokenAt: { instant: "2026-10-18T17:41:46.000Z", timeZone: "America/Sao_Paulo" },
    }));
    const { summary } = await new MeetingSummaryGenerator({
      maxChunkCharacters: 500_000,
      provider,
    }).generate(entries);
    expect(summary.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerNames: ["Bruno"], deadlineDate: "2026-10-21" }),
        expect.objectContaining({
          ownerNames: expect.arrayContaining(["Carla", "Diego"]),
          deadlineDate: "2026-10-19",
        }),
      ]),
    );
  });
});
