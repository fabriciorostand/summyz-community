import { describe, expect, it } from "vitest";

import {
  assessModelCompatibility,
  aiProfileSchema,
  createInitialAiProfile,
  isAiProfileComplete,
  resolveAiProfile,
} from "../src/ai-profile.js";

const gibibyte = 1_024 ** 3;

describe("perfis de IA", () => {
  it("cria o Profile 1 local sem escolher modelos", () => {
    const profile = createInitialAiProfile("user-1", "local", "en");

    expect(profile).toMatchObject({
      name: "Profile 1",
      profileType: "local",
      refinement: { maxChunkCharacters: 500_000, model: null, provider: "ollama" },
      summary: {
        language: "auto",
        maxChunkCharacters: 500_000,
        model: null,
        provider: "ollama",
      },
      transcription: {
        batchSize: "auto",
        interSpeechSilenceMs: 0,
        language: "auto",
        model: null,
        provider: "faster-whisper",
      },
      userId: "user-1",
    });
    expect(isAiProfileComplete(profile)).toBe(false);
  });

  it("exige escolha explícita nas três fases e fixa todas as opções no manifesto", () => {
    const profile = aiProfileSchema.parse({
      ...createInitialAiProfile("user-1", "local", "pt-BR"),
      refinement: {
        generation: { seed: 0, temperature: 0, think: false },
        maxChunkCharacters: 3_000,
        model: "qwen3:1.7b",
        prompt: null,
        provider: "ollama",
      },
      summary: {
        consolidationPrompt: null,
        extractionPrompt: null,
        generation: { seed: 0, temperature: 0, think: false },
        language: "pt-BR",
        maxChunkCharacters: 3_000,
        model: "qwen3:4b-instruct-2507-q4_K_M",
        provider: "ollama",
      },
      transcription: {
        batchSize: 2,
        interSpeechSilenceMs: 0,
        language: "pt-BR",
        mergeMaxGapMs: 2_000,
        model: "medium",
        prompt: "Transcreva literalmente.",
        provider: "faster-whisper",
        providerOptions: { vendor: { diarize: false } },
        temperature: 0,
      },
    });

    expect(isAiProfileComplete(profile)).toBe(true);
    expect(resolveAiProfile(profile)).toEqual({
      refinement: {
        generation: { seed: 0, temperature: 0, think: false },
        maxChunkCharacters: 3_000,
        model: "qwen3:1.7b",
        prompt: null,
        provider: "ollama",
      },
      profileType: "local",
      summary: {
        consolidationPrompt: null,
        extractionPrompt: null,
        generation: { seed: 0, temperature: 0, think: false },
        language: "pt-BR",
        maxChunkCharacters: 3_000,
        model: "qwen3:4b-instruct-2507-q4_K_M",
        provider: "ollama",
      },
      transcription: {
        batchSize: 2,
        interSpeechSilenceMs: 0,
        language: "pt-BR",
        mergeMaxGapMs: 2_000,
        model: "medium",
        prompt: "Transcreva literalmente.",
        provider: "faster-whisper",
        providerOptions: { vendor: { diarize: false } },
        temperature: 0,
        vad: {
          enabled: true,
          maxSpeechDurationSeconds: "auto",
          minSilenceDurationMs: "auto",
          minSpeechDurationMs: 0,
          negativeSpeechThreshold: "auto",
          speechPadMs: 400,
          threshold: 0.5,
        },
      },
    });
  });

  it("não escolhe outro modelo e classifica recomendações apenas como aviso", () => {
    const hardware = {
      accelerators: [
        { id: "gpu-0", memoryBytes: 4 * gibibyte, name: "RTX", vendor: "nvidia" as const },
      ],
      cpuCores: 8,
      gpuMemoryBytes: 4 * gibibyte,
      memoryBytes: 16 * gibibyte,
    };

    expect(
      assessModelCompatibility({
        hardware,
        model: "medium",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("recommended");
    expect(
      assessModelCompatibility({
        hardware,
        model: "large-v3",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("above_recommended");
    expect(
      assessModelCompatibility({
        hardware,
        model: "modelo-personalizado",
        phase: "summary",
        provider: "ollama",
      }),
    ).toBe("unknown");
    expect(
      assessModelCompatibility({
        device: "gpu",
        hardware: {
          ...hardware,
          accelerators: [
            { id: "gpu-0", memoryBytes: 8 * gibibyte, name: "Radeon", vendor: "amd" as const },
          ],
        },
        model: "medium",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("incompatible");
  });

  it("cobre perfis incompletos, provedores remotos e limites de CPU/GPU", () => {
    expect(() => resolveAiProfile(createInitialAiProfile("user-1", "external", "pt-BR"))).toThrow(
      /incomplete/i,
    );

    const cpuHardware = {
      cpuCores: 8,
      memoryBytes: 16 * gibibyte,
    };
    expect(
      assessModelCompatibility({
        hardware: cpuHardware,
        model: "vendor/model",
        phase: "summary",
        provider: "openrouter",
      }),
    ).toBe("unknown");
    expect(
      assessModelCompatibility({
        device: "cpu",
        hardware: cpuHardware,
        model: "qwen3:1.7b",
        phase: "refinement",
        provider: "ollama",
      }),
    ).toBe("compatible");
    expect(
      assessModelCompatibility({
        hardware: { cpuCores: 1, memoryBytes: 2 * gibibyte },
        model: "qwen3:1.7b",
        phase: "refinement",
        provider: "ollama",
      }),
    ).toBe("above_recommended");
    expect(
      assessModelCompatibility({
        device: "gpu",
        hardware: {
          accelerators: [{ id: "gpu-0", memoryBytes: 8 * gibibyte, name: "RTX", vendor: "nvidia" }],
          cpuCores: 8,
          gpuMemoryBytes: 8 * gibibyte,
          memoryBytes: 16 * gibibyte,
        },
        model: "tiny",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("compatible");
    expect(
      assessModelCompatibility({
        device: "cpu",
        hardware: { cpuCores: 1, memoryBytes: 16 * gibibyte },
        model: "qwen3:1.7b",
        phase: "refinement",
        provider: "ollama",
      }),
    ).toBe("above_recommended");
    expect(
      assessModelCompatibility({
        device: "gpu",
        hardware: {
          accelerators: [{ id: "gpu-0", memoryBytes: 8 * gibibyte, name: "RTX", vendor: "nvidia" }],
          cpuCores: 8,
          gpuMemoryBytes: 7 * gibibyte,
          memoryBytes: 16 * gibibyte,
        },
        model: "medium",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("compatible");
    expect(
      assessModelCompatibility({
        device: "gpu",
        hardware: {
          cpuCores: 8,
          gpuMemoryBytes: 8 * gibibyte,
          memoryBytes: 16 * gibibyte,
        },
        model: "medium",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("incompatible");
    expect(
      assessModelCompatibility({
        device: "gpu",
        hardware: {
          accelerators: [{ id: "gpu-0", name: "RTX", vendor: "nvidia" }],
          cpuCores: 8,
          memoryBytes: 16 * gibibyte,
        },
        model: "tiny",
        phase: "transcription",
        provider: "faster-whisper",
      }),
    ).toBe("above_recommended");
  });
});
