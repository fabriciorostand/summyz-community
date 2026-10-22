import { describe, expect, it, vi } from "vitest";

import { OllamaRefinementProvider } from "../src/refinement/ollama-refinement-provider.js";
import {
  IncompatibleRefinementResponseError,
  RefinementProviderFailureError,
} from "../src/refinement/refinement-provider.js";

describe("OllamaRefinementProvider", () => {
  it("exige JSON estruturado e preserva metadados e idioma das entradas", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            message: { content: JSON.stringify({ blocks: [{ id: "id-1", text: "Hello!" }] }) },
          }),
          { status: 200 },
        ),
    );
    const provider = new OllamaRefinementProvider({ fetch, model: "qwen3:4b", timeoutMs: 120_000 });
    const input = [{ endedAtMs: 2, id: "id-1", speaker: "A", startedAtMs: 1, text: "Helo!" }];

    await expect(provider.refine(input)).resolves.toEqual({
      attempts: 1,
      entries: [{ ...input[0], text: "Hello!" }],
    });
    const request: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1].body));
    expect(request).toMatchObject({ format: { type: "object" }, model: "qwen3:4b" });
    expect(JSON.stringify(request)).toContain("original language");
  });

  it("classifica uma saída incompatível sem condenar o modelo por uma única requisição", async () => {
    const provider = new OllamaRefinementProvider({
      fetch: vi.fn(
        async (_url: string, _init: RequestInit) =>
          new Response(JSON.stringify({ message: { content: "not-json" } }), { status: 200 }),
      ),
      model: "broken:latest",
      timeoutMs: 120_000,
    });

    const operation = provider.refine([]);
    await expect(operation).rejects.toBeInstanceOf(RefinementProviderFailureError);
    await expect(operation).rejects.toMatchObject({
      cause: expect.any(IncompatibleRefinementResponseError),
    });
  });
});
