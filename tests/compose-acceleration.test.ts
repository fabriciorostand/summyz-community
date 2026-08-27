import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { selectComposeAcceleration } from "../src/local-ai/compose-acceleration.js";

const gibibyte = 1_024 ** 3;

describe("selectComposeAcceleration", () => {
  it("usa um executável Python disponível nas imagens CPU e CUDA no healthcheck", () => {
    const compose = readFileSync(new URL("../docker-compose.yaml", import.meta.url), "utf8");

    expect(compose).toContain('"python3",');
    expect(compose).not.toContain('"python",');
  });

  it("aguarda os serviços locais ficarem saudáveis antes de iniciar o bot", () => {
    const compose = readFileSync(new URL("../docker-compose.yaml", import.meta.url), "utf8");
    const postgresService = compose.split("\n  postgres:")[1]?.split("\n  bot:")[0];

    expect(compose).toMatch(/bot:[\s\S]+postgres:\s+condition: service_healthy/u);
    expect(postgresService).not.toContain("profiles:");
  });

  it("seleciona o overlay NVIDIA para todas as fases locais compatíveis", () => {
    const result = selectComposeAcceleration({
      device: "auto",
      fallback: "none",
      hardware: hardware("nvidia"),
      phases: ["transcription", "refinement", "summary"],
      platform: "win32",
    });

    expect(result).toMatchObject({ overlays: ["docker-compose.nvidia.yaml"] });
    expect(result.environment).toMatchObject({ SUMMYZ_DETECTED_GPU_VENDOR: "nvidia" });
  });

  it("seleciona ROCm para as fases Ollama em AMD no Linux", () => {
    const result = selectComposeAcceleration({
      device: "auto",
      fallback: "none",
      hardware: hardware("amd"),
      phases: ["refinement", "summary"],
      platform: "linux",
    });

    expect(result.overlays).toEqual(["docker-compose.amd.yaml"]);
  });

  it("não finge suporte AMD no Docker Desktop do Windows", () => {
    expect(() =>
      selectComposeAcceleration({
        device: "auto",
        fallback: "none",
        hardware: hardware("amd"),
        phases: ["summary"],
        platform: "win32",
      }),
    ).toThrow(/AMD.*Windows/i);
  });

  it("só aceita CPU numa implantação incompatível quando fallback foi autorizado", () => {
    const result = selectComposeAcceleration({
      device: "auto",
      fallback: "cpu",
      hardware: hardware("amd"),
      phases: ["summary"],
      platform: "win32",
    });

    expect(result).toEqual({ environment: {}, overlays: [] });
  });

  it("não adiciona overlay quando CPU foi escolhida", () => {
    expect(
      selectComposeAcceleration({
        device: "cpu",
        fallback: "none",
        hardware: hardware("nvidia"),
        phases: ["transcription"],
        platform: "linux",
      }),
    ).toEqual({ environment: {}, overlays: [] });
  });

  it("não adiciona overlay quando não há fase local ou GPU detectada", () => {
    expect(
      selectComposeAcceleration({
        device: "auto",
        fallback: "none",
        hardware: hardware("nvidia"),
        phases: [],
        platform: "linux",
      }),
    ).toEqual({ environment: {}, overlays: [] });
    expect(
      selectComposeAcceleration({
        device: "auto",
        fallback: "none",
        hardware: { cpuCores: 8, memoryBytes: 16 * gibibyte },
        phases: ["refinement", "summary", "transcription"],
        platform: "linux",
      }),
    ).toEqual({ environment: {}, overlays: [] });
  });

  it("combina overlays quando GPUs NVIDIA e AMD atendem fases diferentes", () => {
    const result = selectComposeAcceleration({
      device: "auto",
      fallback: "none",
      hardware: {
        accelerators: [
          { id: "nvidia-0", memoryBytes: 6 * gibibyte, name: "RTX", vendor: "nvidia" },
          { id: "amd-0", memoryBytes: 12 * gibibyte, name: "Radeon", vendor: "amd" },
        ],
        cpuCores: 8,
        gpuMemoryBytes: 12 * gibibyte,
        memoryBytes: 16 * gibibyte,
      },
      phases: ["transcription", "refinement", "summary"],
      platform: "linux",
    });

    expect(result.overlays).toEqual(["docker-compose.nvidia.yaml", "docker-compose.amd.yaml"]);
    expect(result.environment).toMatchObject({ SUMMYZ_DETECTED_GPU_NAME: "amd-0" });
  });

  it("rejeita fabricante sem perfil e aceita fallback explícito", () => {
    const unknownHardware = {
      ...hardware("amd"),
      accelerators: [{ id: "gpu-0", name: "Mystery GPU", vendor: "unknown" as const }],
    };
    expect(() =>
      selectComposeAcceleration({
        device: "auto",
        fallback: "none",
        hardware: unknownHardware,
        phases: ["summary"],
        platform: "linux",
      }),
    ).toThrow(/unknown.*profile/i);
    expect(
      selectComposeAcceleration({
        device: "auto",
        fallback: "cpu",
        hardware: unknownHardware,
        phases: ["summary"],
        platform: "linux",
      }),
    ).toEqual({ environment: {}, overlays: [] });
  });

  it("omite memória desconhecida do ambiente injetado", () => {
    const result = selectComposeAcceleration({
      device: "auto",
      fallback: "none",
      hardware: {
        accelerators: [{ id: "gpu-0", name: "NVIDIA", vendor: "nvidia" }],
        cpuCores: 8,
        memoryBytes: 16 * gibibyte,
      },
      phases: ["transcription"],
      platform: "linux",
    });

    expect(result.environment).toEqual({
      SUMMYZ_DETECTED_GPU_NAME: "gpu-0",
      SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
    });
  });
});

function hardware(vendor: "amd" | "nvidia") {
  return {
    accelerators: [{ id: "gpu-0", memoryBytes: 6 * gibibyte, name: `${vendor} GPU`, vendor }],
    cpuCores: 8,
    memoryBytes: 16 * gibibyte,
  };
}
