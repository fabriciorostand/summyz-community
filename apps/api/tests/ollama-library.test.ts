import { describe, expect, it } from "vitest";
import { parseOllamaFamilies, parseOllamaVariants } from "../src/models/ollama-library.js";

describe("public Ollama library parsing", () => {
  it("extracts public families and rejects paths or external links", () => {
    expect(
      parseOllamaFamilies(
        '<a href="/library/qwen3">Qwen</a><a href="/library/../../secret">bad</a><a href="https://evil/library/x">x</a>',
      ),
    ).toEqual([
      {
        model: "qwen3:latest",
        family: "qwen3",
        name: "qwen3",
        sizeBytes: null,
        variantsAvailable: true,
      },
    ]);
  });
  it("reads downloadable text variants and sizes, excluding cloud and embedding entries", () => {
    const html =
      '<a href="/library/qwen3:8b">qwen3:8b • 5.2GB • Text input</a><a href="/library/qwen3:cloud">Cloud</a><a href="/library/qwen3:embed">100MB • Embedding</a>';
    expect(parseOllamaVariants(html, "qwen3")).toEqual([
      { model: "qwen3:8b", family: "qwen3", name: "qwen3:8b", sizeBytes: 5_200_000_000 },
    ]);
    expect(() => parseOllamaFamilies("<html>layout changed</html>")).toThrow();
  });
});
