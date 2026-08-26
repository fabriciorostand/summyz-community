import { describe, expect, it, vi } from "vitest";

import { LocalModelManager } from "../src/local-ai/local-model-manager.js";
import { createLogger } from "../src/logger.js";
import type { MeetingAiConfiguration } from "../src/recording/manifest.js";

function configuration(model = "qwen3:4b"): MeetingAiConfiguration {
  return {
    refinement: {
      model,
      provider: "ollama",
      requestedModel: "auto",
      status: "selected",
    },
    selectorVersion: 1,
    summary: {
      language: "auto",
      model,
      provider: "ollama",
      requestedModel: "auto",
      status: "selected",
    },
    transcription: {
      language: "auto",
      model: "small",
      provider: "faster-whisper",
      requestedModel: "auto",
      status: "selected",
    },
  };
}

describe("LocalModelManager", () => {
  it("baixa e valida contratos das duas fases Ollama e prepara faster-whisper", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/api/chat")) {
        const refinement = String(init.body).includes("block unchanged");
        const content = refinement
          ? { blocks: [{ id: "probe-1", text: "Hello world." }] }
          : {
              decisions: [],
              discussedTopics: [],
              executiveSummary: "Empty meeting.",
              observations: [],
              tasks: [],
            };
        return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), {
          status: 200,
        });
      }
      return new Response("", { status: 200 });
    });
    const manager = new LocalModelManager({
      configuration: configuration(),
      fetch,
      logger: createLogger("silent"),
    });

    await manager.prepare();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      expect.arrayContaining([
        "http://ollama:11434/api/pull",
        "http://ollama:11434/api/chat",
        "http://faster-whisper:8000/models/prepare",
      ]),
    );
  });

  it("remove modelo Ollama quando todas as fases falham na validação estruturada", async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit) =>
      url.endsWith("/api/chat")
        ? new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 })
        : new Response("", { status: 200 }),
    );
    const manager = new LocalModelManager({
      configuration: configuration("broken:latest"),
      fetch,
      logger: createLogger("silent"),
    });

    await manager.prepare();

    expect(fetch.mock.calls.map(([url]) => url)).toContain("http://ollama:11434/api/delete");
  });

  it("limpa instalação faster-whisper rejeitada e não usa Ollama", async () => {
    const fetch = vi.fn(async (url: string, _init: RequestInit) =>
      url.endsWith("/models/prepare")
        ? new Response("", { status: 422 })
        : new Response("", { status: 200 }),
    );
    const manager = new LocalModelManager({
      configuration: fasterWhisperOnlyConfiguration(),
      fetch,
      logger: createLogger("silent"),
    });

    await manager.prepare();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://faster-whisper:8000/models/prepare",
      "http://faster-whisper:8000/models/delete",
    ]);
  });

  it("descarrega modelo inválido e só apaga os pesos quando nenhuma fase válida o usa", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("", { status: 200 }),
    );
    const manager = new LocalModelManager({
      configuration: configuration(),
      fetch,
      logger: createLogger("silent"),
    });

    await manager.rejectOllamaModel("qwen3:4b", "refinement");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["http://ollama:11434/api/generate"]);

    await manager.rejectOllamaModel("qwen3:4b", "summary");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "http://ollama:11434/api/generate",
      "http://ollama:11434/api/generate",
      "http://ollama:11434/api/delete",
    ]);
  });

  it("expõe o aviso de hardware mantendo um modelo local selecionado", () => {
    const insufficient: MeetingAiConfiguration = {
      ...configuration(),
      summary: {
        hardwareWarning: true,
        language: "auto",
        model: "qwen3:4b",
        provider: "ollama",
        requestedModel: "auto",
        status: "selected",
      },
    };

    expect(
      new LocalModelManager({
        configuration: insufficient,
        logger: createLogger("silent"),
      }).hasInsufficientHardware(),
    ).toBe(true);
  });

  it("prepara o modelo local mesmo quando a seleção possui aviso de hardware", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("", { status: 200 }),
    );
    const baseConfiguration = fasterWhisperOnlyConfiguration();
    const underprovisioned: MeetingAiConfiguration = {
      ...baseConfiguration,
      transcription: {
        hardwareWarning: true,
        language: "auto",
        model: "tiny",
        provider: "faster-whisper",
        requestedModel: "auto",
        status: "selected",
      },
    };
    const manager = new LocalModelManager({
      configuration: underprovisioned,
      fetch,
      logger: createLogger("silent"),
    });

    await manager.prepare();

    expect(fetch.mock.calls.map(([url]) => url)).toContain(
      "http://faster-whisper:8000/models/prepare",
    );
  });

  it("não deixa falha de preparação impedir a inicialização do bot", async () => {
    const manager = new LocalModelManager({
      configuration: configuration("qwen3:8b"),
      fetch: vi.fn(async () => {
        throw new Error("service unavailable");
      }),
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).resolves.toBeUndefined();
  });

  it("trata status HTTP Ollama como indisponibilidade e não apaga pesos válidos", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response("", { status: 503 }),
    );
    const manager = new LocalModelManager({
      configuration: configuration(),
      fetch,
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).resolves.toBeUndefined();
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain("http://ollama:11434/api/delete");
  });
});

function fasterWhisperOnlyConfiguration(): MeetingAiConfiguration {
  return {
    refinement: {
      model: "remote-refinement",
      provider: "openrouter",
      requestedModel: "remote-refinement",
      status: "selected",
    },
    selectorVersion: 1,
    summary: {
      language: "auto",
      model: "remote-summary",
      provider: "openrouter",
      requestedModel: "remote-summary",
      status: "selected",
    },
    transcription: {
      language: "auto",
      model: "invalid-whisper",
      provider: "faster-whisper",
      requestedModel: "invalid-whisper",
      status: "selected",
    },
  };
}
