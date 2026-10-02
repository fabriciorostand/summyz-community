import { describe, expect, it } from "vitest";
import { aiProfileSchema, createInitialAiProfile, resolveAiProfile } from "../src/ai-profile.js";
import { resolveLocalExecutionPlan } from "../src/local-ai/local-execution-policy.js";
import { meetingAiConfigurationSchema } from "../src/recording/manifest.js";

describe("local stage devices", () => {
  it("uses only accelerators exposed by the Ollama GPU service on mixed-vendor hosts", () => {
    const plan = resolveLocalExecutionPlan({
      device: "auto",
      fallback: "none",
      enabledPhases: ["summary"],
      hardware: {
        cpuCores: 8,
        memoryBytes: 16 * 1024 ** 3,
        ollamaGpuVendor: "nvidia",
        accelerators: [
          { id: "nvidia", name: "NVIDIA", vendor: "nvidia", memoryBytes: 6 * 1024 ** 3 },
          { id: "amd", name: "AMD", vendor: "amd", memoryBytes: 16 * 1024 ** 3 },
        ],
      },
    });
    expect(plan.summary).toMatchObject({ gpuId: "nvidia", gpuMemoryBytes: 6 * 1024 ** 3 });
  });
  it("defaults each new local stage to auto and keeps API stages free of device selection", () => {
    const profile = createInitialAiProfile("local", "en");
    for (const stage of ["transcription", "refinement", "summary"] as const)
      expect(profile[stage]).toHaveProperty("device", "auto");
    const external = createInitialAiProfile("external", "en");
    for (const stage of ["transcription", "refinement", "summary"] as const) {
      expect(external[stage]).not.toHaveProperty("device");
      expect(
        aiProfileSchema.safeParse({ ...external, [stage]: { ...external[stage], device: "gpu" } })
          .success,
      ).toBe(false);
    }
  });
  it("preserves independent device choices in the meeting snapshot", () => {
    const profile = createInitialAiProfile("local", "en");
    const configured = aiProfileSchema.parse({
      ...profile,
      transcription: { ...profile.transcription, model: "small", device: "cpu" },
      refinement: { ...profile.refinement, model: "qwen3:8b", device: "gpu" },
      summary: { ...profile.summary, model: "qwen3:4b", device: "auto" },
    });
    const snapshot = meetingAiConfigurationSchema.parse(resolveAiProfile(configured));
    expect(snapshot.transcription).toHaveProperty("device", "cpu");
    expect(snapshot.refinement).toHaveProperty("device", "gpu");
    expect(snapshot.summary).toHaveProperty("device", "auto");
  });
  it("uses CPU in auto for unavailable GPU services without replacing an explicit GPU choice", () => {
    const hardware = {
      cpuCores: 8,
      memoryBytes: 16 * 1024 ** 3,
      accelerators: [{ id: "gpu", name: "GPU", vendor: "nvidia" as const }],
      gpuAvailability: { ollama: true, "faster-whisper": false },
    };
    expect(
      resolveLocalExecutionPlan({
        device: "auto",
        fallback: "none",
        devices: { refinement: "cpu" },
        hardware,
      }),
    ).toMatchObject({
      transcription: { device: "cpu" },
      refinement: { device: "cpu" },
      summary: { device: "gpu" },
    });
    expect(() =>
      resolveLocalExecutionPlan({
        device: "auto",
        fallback: "none",
        devices: { transcription: "gpu" },
        hardware,
      }),
    ).toThrow(/transcription.*GPU/);
  });
});
