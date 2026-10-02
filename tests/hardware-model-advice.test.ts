import { describe, expect, it } from "vitest";
import { assessModelCompatibility } from "../src/ai-profile-compatibility.js";

describe("balanced hardware model estimates", () => {
  it("recommends different CPU checkpoints as core and RAM budgets change", () => {
    const input = {
      device: "cpu" as const,
      phase: "transcription" as const,
      provider: "faster-whisper" as const,
    };
    expect(
      assessModelCompatibility({
        ...input,
        model: "small",
        hardware: { cpuCores: 8, memoryBytes: 16 * 1024 ** 3 },
      }),
    ).toBe("recommended");
    expect(
      assessModelCompatibility({
        ...input,
        model: "medium",
        hardware: { cpuCores: 8, memoryBytes: 16 * 1024 ** 3 },
      }),
    ).toBe("compatible");
    expect(
      assessModelCompatibility({
        ...input,
        model: "medium",
        hardware: { cpuCores: 16, memoryBytes: 32 * 1024 ** 3 },
      }),
    ).toBe("recommended");
  });
  it("estimates unfamiliar quantized models from their size, parameters and stage", () => {
    const hardware = { cpuCores: 8, memoryBytes: 16 * 1024 ** 3 };
    const input = {
      device: "cpu" as const,
      provider: "ollama" as const,
      phase: "summary" as const,
      model: "other:7b-q4",
      hardware,
    };
    expect(assessModelCompatibility({ ...input, modelSizeBytes: 4 * 1024 ** 3 })).toBe(
      "recommended",
    );
    expect(assessModelCompatibility({ ...input, modelSizeBytes: 20 * 1024 ** 3 })).toBe(
      "above_recommended",
    );
    expect(assessModelCompatibility(input)).toBe("unknown");
  });
});
