import { describe, expect, it, vi } from "vitest";

import { MeetingRefinementGenerator } from "../src/refinement/meeting-refinement-generator.js";
import {
  IncompatibleRefinementResponseError,
  RefinementProviderFailureError,
  RefinementRequestError,
} from "../src/refinement/refinement-provider.js";

const entries = [
  { endedAtMs: 2_000, id: "a", speaker: "Ana", startedAtMs: 1_000, text: "um texto" },
  { endedAtMs: 4_000, id: "b", speaker: "Bia", startedAtMs: 3_000, text: "outro texto" },
];

describe("MeetingRefinementGenerator", () => {
  it("rejeita limite inválido e conclui transcrição vazia sem chamar o provedor", async () => {
    const refine = vi.fn();
    expect(
      () => new MeetingRefinementGenerator({ maxChunkCharacters: 0, provider: { refine } }),
    ).toThrow(/limite/i);
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: 1,
      provider: { refine },
    });
    await expect(generator.generate([])).resolves.toEqual({ attempts: 0, entries: [] });
    expect(refine).not.toHaveBeenCalled();
  });

  it("divide somente entre falas e agrega tentativas sem alterar a ordem", async () => {
    const refine = vi.fn(async (chunk: typeof entries) => ({
      attempts: 1,
      entries: chunk.map((entry) => ({ ...entry, text: entry.text.toUpperCase() })),
    }));
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: 1,
      provider: { refine },
    });

    await expect(generator.generate(entries)).resolves.toEqual({
      attempts: 2,
      entries: entries.map((entry) => ({ ...entry, text: entry.text.toUpperCase() })),
    });
    expect(refine).toHaveBeenCalledTimes(2);
    expect(refine.mock.calls[0]?.[0]).toEqual([entries[0]]);
  });

  it("acumula as tentativas dos blocos anteriores ao propagar uma falha", async () => {
    const refine = vi
      .fn()
      .mockResolvedValueOnce({ attempts: 1, entries: [entries[0]] })
      .mockRejectedValueOnce(new RefinementProviderFailureError(3, new Error("falha")));
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: 1,
      provider: { refine },
    });

    await expect(generator.generate(entries)).rejects.toMatchObject({ attempts: 4 });
  });

  it("subdivide um lote quando o modelo não preserva sua estrutura", async () => {
    const refine = vi
      .fn()
      .mockRejectedValueOnce(
        new RefinementProviderFailureError(1, new IncompatibleRefinementResponseError()),
      )
      .mockImplementation(async (chunk: typeof entries) => ({ attempts: 1, entries: chunk }));
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: 10_000,
      provider: { refine },
    });

    await expect(generator.generate(entries)).resolves.toEqual({ attempts: 3, entries });
    expect(refine).toHaveBeenNthCalledWith(1, entries);
    expect(refine).toHaveBeenNthCalledWith(2, [entries[0]]);
    expect(refine).toHaveBeenNthCalledWith(3, [entries[1]]);
  });

  it("subdivide um lote após timeout sem repetir o lote inteiro", async () => {
    const refine = vi
      .fn()
      .mockRejectedValueOnce(
        new RefinementProviderFailureError(
          1,
          new RefinementRequestError({ retryable: false, timedOut: true }),
        ),
      )
      .mockImplementation(async (chunk: typeof entries) => ({ attempts: 1, entries: chunk }));
    const generator = new MeetingRefinementGenerator({
      maxChunkCharacters: 10_000,
      provider: { refine },
    });

    await expect(generator.generate(entries)).resolves.toEqual({ attempts: 3, entries });
    expect(refine).toHaveBeenNthCalledWith(1, entries);
    expect(refine).toHaveBeenNthCalledWith(2, [entries[0]]);
    expect(refine).toHaveBeenNthCalledWith(3, [entries[1]]);
  });

  it("não subdivide indisponibilidade nem uma única entrada incompatível", async () => {
    const firstEntry = entries[0];
    if (firstEntry === undefined) throw new Error("Entrada de teste ausente");
    const unavailable = vi.fn(async () => {
      throw new RefinementProviderFailureError(1, new Error("offline"));
    });
    await expect(
      new MeetingRefinementGenerator({
        maxChunkCharacters: 10_000,
        provider: { refine: unavailable },
      }).generate(entries),
    ).rejects.toMatchObject({ attempts: 1 });
    expect(unavailable).toHaveBeenCalledOnce();

    const incompatible = vi.fn(async () => {
      throw new RefinementProviderFailureError(1, new IncompatibleRefinementResponseError());
    });
    await expect(
      new MeetingRefinementGenerator({
        maxChunkCharacters: 1,
        provider: { refine: incompatible },
      }).generate([firstEntry]),
    ).rejects.toMatchObject({ attempts: 1 });
    expect(incompatible).toHaveBeenCalledOnce();
  });
});
