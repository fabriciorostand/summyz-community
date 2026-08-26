import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  IncompatibleOllamaModelError,
  OllamaRequestError,
  requestOllamaStructured,
} from "../src/local-ai/ollama-client.js";

const baseOptions = {
  input: { value: true },
  instruction: "Return structured data.",
  jsonSchema: { properties: { ok: { type: "boolean" } }, type: "object" },
  model: "model:latest",
  outputSchema: z.object({ ok: z.boolean() }),
  timeoutMs: 1_000,
};

describe("requestOllamaStructured", () => {
  it("diferencia indisponibilidade de rede de resposta incompatível", async () => {
    const networkFailure = requestOllamaStructured({
      ...baseOptions,
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(networkFailure).rejects.toMatchObject({
      name: "OllamaRequestError",
      status: undefined,
    });

    const incompatible = requestOllamaStructured({
      ...baseOptions,
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 }),
      ),
    });
    await expect(incompatible).rejects.toBeInstanceOf(IncompatibleOllamaModelError);
  });

  it("preserva o status HTTP sem tratar indisponibilidade como modelo inválido", async () => {
    const operation = requestOllamaStructured({
      ...baseOptions,
      fetch: vi.fn(async () => new Response("", { status: 503 })),
    });

    await expect(operation).rejects.toBeInstanceOf(OllamaRequestError);
    await expect(operation).rejects.toMatchObject({ status: 503 });
  });

  it("aceita URL interna sobrescrita e valida o resultado", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), { status: 200 }),
    );

    await expect(
      requestOllamaStructured({ ...baseOptions, baseUrl: "http://ollama-test:11434", fetch }),
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("http://ollama-test:11434/api/chat", expect.any(Object));
  });
});
