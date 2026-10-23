import { describe, expect, it } from "vitest";

import {
  aggregatePredominantLanguage,
  normalizeDetectedLanguage,
} from "../src/transcription/predominant-language.js";

describe("idioma predominante", () => {
  it("normaliza códigos e nomes conhecidos para a tag primária BCP 47", () => {
    expect(normalizeDetectedLanguage("pt-BR")).toBe("pt");
    expect(normalizeDetectedLanguage("Portuguese")).toBe("pt");
    expect(normalizeDetectedLanguage("ENGLISH")).toBe("en");
    expect(() => normalizeDetectedLanguage("not-a-language")).toThrow(/language/i);
  });

  it("aceita tags primárias válidas mesmo fora do catálogo configurável", () => {
    expect(normalizeDetectedLanguage("cy-GB")).toBe("cy");
    expect(normalizeDetectedLanguage("fil")).toBe("fil");
  });

  it("agrega todos os lotes pela duração e escolhe sempre a maior evidência", () => {
    expect(
      aggregatePredominantLanguage([
        { durationMs: 60_000, language: "pt", probability: 0.51 },
        { durationMs: 20_000, language: "en", probability: 0.99 },
        { durationMs: 10_000, language: "es", probability: 0.1 },
      ]),
    ).toMatchObject({
      confidence: expect.any(Number),
      distribution: { en: 19_800, es: 1_000, pt: 30_600 },
      language: "pt",
    });
  });

  it("usa duração inteira quando o provedor não fornece confiança", () => {
    expect(
      aggregatePredominantLanguage([
        { durationMs: 5_000, language: "en" },
        { durationMs: 7_000, language: "fr" },
      ]).language,
    ).toBe("fr");
  });

  it("resolve empates deterministicamente e aceita confiança zero", () => {
    expect(
      aggregatePredominantLanguage([
        { durationMs: 1_000, language: "pt", probability: 0 },
        { durationMs: 1_000, language: "en", probability: 0 },
      ]),
    ).toEqual({ confidence: 0, distribution: { en: 0, pt: 0 }, language: "en" });
  });

  it("falha fechado quando nenhum lote falado informa idioma válido", () => {
    expect(() => aggregatePredominantLanguage([])).toThrow(/language/i);
  });
});
