import { describe, expect, it } from "vitest";

import {
  calculateErrorRate,
  calculateTranscriptMetrics,
  normalizeTranscriptForBenchmark,
} from "../src/local-ai/transcription-benchmark.js";

describe("transcription benchmark metrics", () => {
  it("remove timestamps e nomes dos participantes sem perder acentos", () => {
    expect(
      normalizeTranscriptForBenchmark(
        "[00:00:01.000 – 00:00:02.000] Fab: Olá, mundo!\n[00:00:03.000 – 00:00:04.000] Ana: Tudo bem?\n",
      ),
    ).toBe("olá mundo tudo bem");
  });

  it("calcula distância normalizada inclusive para referência vazia", () => {
    expect(calculateErrorRate(["a", "b", "c"], ["a", "x", "c"])).toBeCloseTo(1 / 3);
    expect(calculateErrorRate([], [])).toBe(0);
    expect(calculateErrorRate([], ["extra"])).toBe(1);
  });

  it("calcula WER e CER a partir de transcrições completas", () => {
    expect(calculateTranscriptMetrics("Fab: um dois", "Fab: um três")).toEqual({
      characterErrorRate: 3 / 11,
      wordErrorRate: 1 / 3,
    });
    expect(calculateTranscriptMetrics("", "")).toEqual({
      characterErrorRate: 0,
      wordErrorRate: 0,
    });
  });
});
