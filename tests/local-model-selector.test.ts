import { describe, expect, it } from "vitest";

import {
  selectLocalModel,
  type LocalModelCandidate,
} from "../src/local-ai/local-model-selector.js";

const gibibyte = 1_024 ** 3;

describe("selectLocalModel", () => {
  it("respeita o modelo explícito sem substituí-lo silenciosamente", () => {
    expect(
      selectLocalModel({
        hardware: { cpuCores: 4, memoryBytes: 4 * gibibyte },
        language: "auto",
        phase: "summary",
        requestedModel: "custom/model:latest",
      }),
    ).toEqual({ model: "custom/model:latest", source: "explicit", status: "selected" });
  });

  it("seleciona independentemente o melhor modelo que cabe em cada fase", () => {
    const hardware = { cpuCores: 8, memoryBytes: 16 * gibibyte };

    const transcription = selectLocalModel({
      hardware,
      language: "auto",
      phase: "transcription",
      requestedModel: "auto",
    });
    const refinement = selectLocalModel({
      hardware,
      language: "auto",
      phase: "refinement",
      requestedModel: "auto",
    });
    const summary = selectLocalModel({
      hardware,
      language: "auto",
      phase: "summary",
      requestedModel: "auto",
    });

    expect(transcription).toMatchObject({ model: "medium", status: "selected" });
    expect(refinement).toMatchObject({ model: "qwen3:8b", status: "selected" });
    expect(summary).toMatchObject({ model: "qwen3:8b", status: "selected" });
  });

  it("considera CPU ao reduzir o modelo e permite que GPU suficiente elimine esse limite", () => {
    expect(
      selectLocalModel({
        hardware: { cpuCores: 2, memoryBytes: 16 * gibibyte },
        language: "auto",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "base" });
    expect(
      selectLocalModel({
        hardware: { cpuCores: 2, gpuMemoryBytes: 12 * gibibyte, memoryBytes: 16 * gibibyte },
        language: "auto",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "medium" });
  });

  it("em auto escolhe qualidade multilíngue geral sem presumir pt-BR", () => {
    const candidates: readonly LocalModelCandidate[] = [
      {
        languages: ["pt-BR"],
        memoryBytes: 2 * gibibyte,
        model: "specialized-pt",
        quality: 100,
      },
      {
        languages: "multilingual",
        memoryBytes: 2 * gibibyte,
        model: "general-multilingual",
        quality: 10,
      },
    ];

    expect(
      selectLocalModel({
        candidates,
        hardware: { cpuCores: 4, memoryBytes: 8 * gibibyte },
        language: "auto",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "general-multilingual" });
  });

  it("considera o idioma especificado no ranking", () => {
    const candidates: readonly LocalModelCandidate[] = [
      {
        languages: ["es"],
        memoryBytes: 2 * gibibyte,
        model: "specialized-es",
        quality: 9.9,
      },
      {
        languages: "multilingual",
        memoryBytes: 2 * gibibyte,
        model: "general-multilingual",
        quality: 10,
      },
    ];

    expect(
      selectLocalModel({
        candidates,
        hardware: { cpuCores: 4, memoryBytes: 8 * gibibyte },
        language: "es-MX",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "specialized-es" });
  });

  it("usa uma variante especializada do catálogo real somente com idioma explícito", () => {
    const hardware = { cpuCores: 4, memoryBytes: 8 * gibibyte };

    expect(
      selectLocalModel({
        hardware,
        language: "auto",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "small" });
    expect(
      selectLocalModel({
        hardware,
        language: "en-US",
        phase: "transcription",
        requestedModel: "auto",
      }),
    ).toMatchObject({ model: "small.en" });
  });

  it("escolhe o menor modelo local e sinaliza hardware insuficiente sem trocar de provedor", () => {
    expect(
      selectLocalModel({
        hardware: { cpuCores: 1, memoryBytes: gibibyte },
        language: "auto",
        phase: "summary",
        requestedModel: "auto",
      }),
    ).toEqual({
      hardwareWarning: true,
      model: "qwen3:4b",
      source: "auto",
      status: "selected",
    });
  });

  it("rejeita catálogo sem nenhum modelo compatível", () => {
    expect(() =>
      selectLocalModel({
        candidates: [],
        hardware: { cpuCores: 1, memoryBytes: gibibyte },
        language: "auto",
        phase: "summary",
        requestedModel: "auto",
      }),
    ).toThrow(/compatible local model/i);
  });
});
