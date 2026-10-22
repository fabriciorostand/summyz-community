import { describe, expect, it } from "vitest";

import { applyRefinement } from "../src/refinement/refinement-result.js";

const entries = [
  {
    endedAtMs: 2_000,
    id: "segment-1:000000",
    speaker: "Fab",
    startedAtMs: 1_000,
    text: "conditivite",
  },
  {
    endedAtMs: 4_000,
    id: "segment-2:000000",
    speaker: "Isa",
    startedAtMs: 3_000,
    text: "Tenho sim",
  },
] as const;

describe("resultado do refinamento", () => {
  it("aplica somente o texto e preserva metadados e ordem", () => {
    expect(
      applyRefinement(entries, [
        { id: "segment-1:000000", text: "conjuntivite" },
        { id: "segment-2:000000", text: "Tenho sim" },
      ]),
    ).toEqual([{ ...entries[0], text: "conjuntivite" }, entries[1]]);
  });

  it("rejeita remoção, adição, reordenação e troca de ids", () => {
    expect(() => applyRefinement(entries, [{ id: "segment-1:000000", text: "texto" }])).toThrow(
      /estrutura/i,
    );
    expect(() =>
      applyRefinement(entries, [
        { id: "segment-2:000000", text: "texto" },
        { id: "segment-1:000000", text: "texto" },
      ]),
    ).toThrow(/estrutura/i);
  });
});
