import { describe, expect, it } from "vitest";

import { resolveLocalExecutionPlan } from "../src/local-ai/local-execution-policy.js";

const gibibyte = 1_024 ** 3;

describe("resolveLocalExecutionPlan", () => {
  it("ignora fases remotas ao exigir GPU", () => {
    const plan = resolveLocalExecutionPlan({
      device: "gpu",
      enabledPhases: [],
      fallback: "none",
      hardware: { cpuCores: 8, memoryBytes: 16 * gibibyte },
    });

    expect(plan).toEqual({
      refinement: { device: "cpu", fallback: "none", fallbackApplied: false },
      summary: { device: "cpu", fallback: "none", fallbackApplied: false },
      transcription: { device: "cpu", fallback: "none", fallbackApplied: false },
    });
  });

  it("usa NVIDIA em todas as fases locais no modo automático", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "none",
      hardware: {
        accelerators: [
          { id: "gpu-0", memoryBytes: 6 * gibibyte, name: "RTX 2060", vendor: "nvidia" },
        ],
        cpuCores: 12,
        memoryBytes: 16 * gibibyte,
      },
    });

    expect(plan).toMatchObject({
      refinement: { device: "gpu", gpuVendor: "nvidia" },
      summary: { device: "gpu", gpuVendor: "nvidia" },
      transcription: { device: "gpu", gpuVendor: "nvidia" },
    });
  });

  it("uses CPU in auto when a detected GPU is incompatible with the stage", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "none",
      hardware: {
        accelerators: [{ id: "gpu", name: "Radeon", vendor: "amd" }],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
    });
    expect(plan.transcription).toMatchObject({ device: "cpu", fallbackApplied: false });
    expect(plan.summary).toMatchObject({ device: "gpu", gpuVendor: "amd" });
  });

  it("usa CPU como hardware primário no automático somente quando não há GPU", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "none",
      hardware: { cpuCores: 8, memoryBytes: 16 * gibibyte },
    });

    expect(plan.transcription).toEqual({
      device: "cpu",
      fallback: "none",
      fallbackApplied: false,
    });
  });

  it("uses CPU as the automatic primary device for an incompatible stage", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "cpu",
      hardware: {
        accelerators: [{ id: "gpu-0", memoryBytes: 12 * gibibyte, name: "Radeon", vendor: "amd" }],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
    });

    expect(plan.transcription).toEqual({ device: "cpu", fallback: "cpu", fallbackApplied: false });
  });

  it("falha quando GPU explícita não é compatível com a transcrição", () => {
    expect(() =>
      resolveLocalExecutionPlan({
        device: "gpu",
        fallback: "none",
        hardware: {
          accelerators: [{ id: "gpu-0", name: "Radeon", vendor: "amd" }],
          cpuCores: 8,
          memoryBytes: 16 * gibibyte,
        },
      }),
    ).toThrow(/transcription.*GPU/i);
  });

  it("aplica fallback explícito para CPU quando GPU não é compatível", () => {
    const plan = resolveLocalExecutionPlan({
      device: "gpu",
      fallback: "cpu",
      hardware: {
        accelerators: [{ id: "gpu-0", name: "Radeon", vendor: "amd" }],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
    });

    expect(plan.transcription).toMatchObject({ device: "cpu", fallbackApplied: true });
    expect(plan.refinement).toMatchObject({ device: "gpu", gpuVendor: "amd" });
  });

  it("força CPU e fallback none mesmo quando outra política chega ao resolvedor", () => {
    const plan = resolveLocalExecutionPlan({
      device: "cpu",
      fallback: "cpu",
      hardware: {
        accelerators: [{ id: "gpu-0", name: "RTX", vendor: "nvidia" }],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
    });

    expect(plan.transcription).toEqual({ device: "cpu", fallback: "none", fallbackApplied: false });
    expect(plan.refinement).toEqual({ device: "cpu", fallback: "none", fallbackApplied: false });
    expect(plan.summary).toEqual({ device: "cpu", fallback: "none", fallbackApplied: false });
  });

  it("prefere a GPU compatível com maior memória", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "none",
      hardware: {
        accelerators: [
          { id: "gpu-0", memoryBytes: 4 * gibibyte, name: "GPU 0", vendor: "nvidia" },
          { id: "gpu-1", memoryBytes: 12 * gibibyte, name: "GPU 1", vendor: "nvidia" },
        ],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
    });

    expect(plan.transcription).toMatchObject({ gpuId: "gpu-1", gpuMemoryBytes: 12 * gibibyte });
  });
});
