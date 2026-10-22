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
  it("rejects GPU results when the model has fallen back to CPU or reports invalid placement", async () => {
    for (const sizeVram of [0, 2048]) {
      const request = vi.fn(async (url: string) =>
        url.endsWith("/api/ps")
          ? Response.json({ models: [{ model: "model:latest", size: 1024, size_vram: sizeVram }] })
          : Response.json({ message: { content: '{"ok":true}' } }),
      );
      await expect(
        requestOllamaStructured({ ...baseOptions, device: "gpu", fetch: request }),
      ).rejects.toMatchObject({ name: "OllamaGpuExecutionError" });
    }
  });

  it("accepts a GPU result only after validating model placement on that instance", async () => {
    const request = vi.fn(async (url: string) =>
      url.endsWith("/api/ps")
        ? Response.json({ models: [{ model: "model:latest", size: 1024, size_vram: 1024 }] })
        : Response.json({ message: { content: '{"ok":true}' } }),
    );
    await expect(
      requestOllamaStructured({
        ...baseOptions,
        baseUrl: "http://gpu:11434",
        device: "gpu",
        fetch: request,
      }),
    ).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenLastCalledWith("http://gpu:11434/api/ps", expect.any(Object));
  });
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
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as Record<string, unknown>;
    expect(request).not.toHaveProperty("options");
    expect(request).not.toHaveProperty("think");

    await requestOllamaStructured({
      ...baseOptions,
      fetch,
      generation: { seed: 0, temperature: 0, think: false },
    });
    const customized = JSON.parse(String(fetch.mock.calls[1]?.[1].body)) as Record<string, unknown>;
    expect(customized).toMatchObject({
      options: { seed: 0, temperature: 0 },
      think: false,
    });
  });

  it("omite a mensagem de sistema quando o prompt está desativado", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), { status: 200 }),
    );

    await requestOllamaStructured({ ...baseOptions, fetch, instruction: null });

    const request = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as {
      messages: { role: string }[];
    };
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]?.role).toBe("user");
  });
});
