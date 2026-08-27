import { describe, expect, it } from "vitest";

import { resolveFasterWhisperBatchSize } from "../src/local-ai/faster-whisper-batch-size.js";

const gibibyte = 1_024 ** 3;

describe("resolveFasterWhisperBatchSize", () => {
  it("preserva valor explícito e permite desativar batching", () => {
    expect(resolveFasterWhisperBatchSize(0, "small", cpuExecution(), 2)).toBe(0);
    expect(resolveFasterWhisperBatchSize(7, "small", cpuExecution(), 2)).toBe(7);
  });

  it("desativa batching automático na CPU", () => {
    expect(resolveFasterWhisperBatchSize("auto", "small", cpuExecution(), 2)).toBe(0);
  });

  it("reduz batching automático conforme VRAM, modelo e concorrência", () => {
    const execution = {
      device: "gpu" as const,
      fallback: "none" as const,
      fallbackApplied: false,
      gpuMemoryBytes: 6 * gibibyte,
      gpuVendor: "nvidia" as const,
    };

    expect(resolveFasterWhisperBatchSize("auto", "small", execution, 2)).toBe(2);
    expect(resolveFasterWhisperBatchSize("auto", "large-v3", execution, 2)).toBe(0);
  });

  it("usa configuração conservadora quando a VRAM não foi informada", () => {
    expect(
      resolveFasterWhisperBatchSize(
        "auto",
        "tiny",
        {
          device: "gpu",
          fallback: "none",
          fallbackApplied: false,
          gpuVendor: "nvidia",
        },
        1,
      ),
    ).toBe(2);
  });

  it("escala lotes maiores e diferencia modelos médios e pequenos", () => {
    const execution = {
      device: "gpu" as const,
      fallback: "none" as const,
      fallbackApplied: false,
      gpuMemoryBytes: 12 * gibibyte,
      gpuVendor: "nvidia" as const,
    };

    expect(resolveFasterWhisperBatchSize("auto", "tiny", execution, 1)).toBe(8);
    expect(resolveFasterWhisperBatchSize("auto", "medium", execution, 2)).toBe(2);
    expect(resolveFasterWhisperBatchSize("auto", "small", execution, 2)).toBe(4);
  });
});

function cpuExecution() {
  return { device: "cpu" as const, fallback: "none" as const, fallbackApplied: false };
}
