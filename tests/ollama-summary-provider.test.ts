import { describe, expect, it, vi } from "vitest";

import { OllamaSummaryProvider } from "../src/summary/ollama-summary-provider.js";
import { SummaryProviderFailureError } from "../src/summary/summary-provider.js";

const validSummary = {
  decisions: [],
  discussedTopics: ["Planning"],
  executiveSummary: "The team planned the release.",
  observations: [],
  tasks: [],
};

describe("OllamaSummaryProvider", () => {
  it("usa o idioma predominante em auto e o schema estruturado", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ message: { content: JSON.stringify(validSummary) } }), {
          status: 200,
        }),
    );
    const provider = new OllamaSummaryProvider({
      fetch,
      language: "auto",
      model: "qwen3:8b",
      timeoutMs: 120_000,
    });

    await expect(provider.summarize([])).resolves.toMatchObject({
      attempts: 1,
      summary: validSummary,
    });
    const request: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1].body));
    expect(request).toMatchObject({ format: { type: "object" }, model: "qwen3:8b" });
    expect(JSON.stringify(request)).toContain("predominant language");
  });

  it("rejeita modelo que não cumpre o contrato sem tentar outro provedor", async () => {
    const onIncompatibleModel = vi.fn(async () => undefined);
    const provider = new OllamaSummaryProvider({
      fetch: vi.fn(
        async (_url: string, _init: RequestInit) =>
          new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 }),
      ),
      language: "pt-BR",
      model: "broken:latest",
      onIncompatibleModel,
      timeoutMs: 120_000,
    });

    await expect(provider.summarize([])).rejects.toBeInstanceOf(SummaryProviderFailureError);
    expect(onIncompatibleModel).toHaveBeenCalledWith("broken:latest");
  });
});
