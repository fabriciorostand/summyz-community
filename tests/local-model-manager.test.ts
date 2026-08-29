import { describe, expect, it, vi } from "vitest";

import { LocalModelManager } from "../src/local-ai/local-model-manager.js";
import type { LocalExecutionPlan } from "../src/local-ai/local-execution-policy.js";
import { createLogger } from "../src/logger.js";
import {
  meetingAiConfigurationSchema,
  type ResolvedMeetingAiConfiguration,
} from "../src/recording/manifest.js";

type LocalProfileAiConfiguration = Extract<
  ResolvedMeetingAiConfiguration,
  { profileType: "local" }
>;

function configuration(model = "qwen3:4b"): LocalProfileAiConfiguration {
  const parsed = meetingAiConfigurationSchema.parse({
    profileType: "local",
    refinement: {
      model,
      provider: "ollama",
    },
    summary: {
      language: "auto",
      model,
      provider: "ollama",
    },
    transcription: {
      language: "auto",
      model: "small",
      provider: "faster-whisper",
    },
  });
  if (parsed.profileType !== "local") throw new Error("Expected a local profile");
  return parsed;
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

    expect(
      fetch.mock.calls.map(([url]) => url).filter((url) => url.includes("faster-whisper")),
    ).toEqual([
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

  it("envia política e batching ao faster-whisper e registra o dispositivo efetivo", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({
        batchSize: 4,
        computeType: "float16",
        device: "cuda",
        fallbackApplied: false,
        model: "small",
        status: "ready",
      }),
    );
    const logger = createLogger("silent");
    const manager = new LocalModelManager({
      batchSize: 4,
      configuration: fasterWhisperOnlyConfiguration(),
      executionPlan: gpuExecutionPlan("cpu"),
      fetch,
      logger,
    });

    await manager.prepare();

    const fasterWhisperRequest = fetch.mock.calls.find(([url]) => url.endsWith("/models/prepare"));
    expect(JSON.parse(String(fasterWhisperRequest?.[1].body))).toEqual({
      batchSize: 4,
      device: "gpu",
      fallback: "cpu",
      model: "invalid-whisper",
    });
  });

  it("propaga falha de preparação quando aceleração é obrigatória", async () => {
    const manager = new LocalModelManager({
      configuration: fasterWhisperOnlyConfiguration(),
      executionPlan: gpuExecutionPlan("none"),
      fetch: vi.fn(async () => new Response("", { status: 422 })),
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).rejects.toThrow(/FasterWhisperPreparationStatus422/);
  });

  it("rejeita dispositivo efetivo diferente da política estrita", async () => {
    const manager = new LocalModelManager({
      configuration: fasterWhisperOnlyConfiguration(),
      executionPlan: gpuExecutionPlan("none"),
      fetch: vi.fn(async () =>
        Response.json({
          batchSize: 0,
          computeType: "int8",
          device: "cpu",
          fallbackApplied: false,
          model: "invalid-whisper",
          status: "ready",
        }),
      ),
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).rejects.toThrow(/active device.*policy/i);
  });

  it("aceita CPU quando o fallback do faster-whisper foi explicitamente autorizado", async () => {
    const manager = new LocalModelManager({
      configuration: fasterWhisperOnlyConfiguration(),
      executionPlan: gpuExecutionPlan("cpu"),
      fetch: vi.fn(async () =>
        Response.json({
          batchSize: 0,
          computeType: "int8",
          device: "cpu",
          fallbackApplied: true,
          model: "invalid-whisper",
          status: "ready",
        }),
      ),
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).resolves.toBeUndefined();
  });

  it("interrompe quando Ollama executa na CPU sem fallback autorizado", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/models/prepare")) {
        return Response.json({
          batchSize: 0,
          computeType: "float16",
          device: "cuda",
          fallbackApplied: false,
          model: "small",
          status: "ready",
        });
      }
      if (url.endsWith("/api/ps")) {
        return Response.json({ models: [{ model: "qwen3:4b", size_vram: 0 }] });
      }
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
        return Response.json({ message: { content: JSON.stringify(content) } });
      }
      return new Response("", { status: 200 });
    });
    const manager = new LocalModelManager({
      configuration: configuration(),
      executionPlan: allGpuExecutionPlan("none"),
      fetch,
      logger: createLogger("silent"),
    });

    await expect(manager.prepare()).rejects.toThrow(/Ollama.*GPU/i);
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

function fasterWhisperOnlyConfiguration(): LocalProfileAiConfiguration {
  const base = configuration();
  return {
    ...base,
    transcription: {
      ...base.transcription,
      model: "invalid-whisper",
    },
  };
}

function gpuExecutionPlan(fallback: "cpu" | "none"): LocalExecutionPlan {
  const cpu = { device: "cpu" as const, fallback: "none" as const, fallbackApplied: false };
  return {
    refinement: cpu,
    summary: cpu,
    transcription: {
      device: "gpu",
      fallback,
      fallbackApplied: false,
      gpuId: "gpu-0",
      gpuMemoryBytes: 6 * 1_024 ** 3,
      gpuVendor: "nvidia",
    },
  };
}

function allGpuExecutionPlan(fallback: "cpu" | "none"): LocalExecutionPlan {
  const gpu = {
    device: "gpu" as const,
    fallback,
    fallbackApplied: false,
    gpuId: "gpu-0",
    gpuMemoryBytes: 6 * 1_024 ** 3,
    gpuVendor: "nvidia" as const,
  };
  return { refinement: gpu, summary: gpu, transcription: gpu };
}
