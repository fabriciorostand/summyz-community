import { describe, expect, it } from "vitest";

import {
  calculateProcessCpuPercent,
  estimatePacketLossPercent,
} from "../src/recording/recording-metrics.js";

describe("métricas da gravação", () => {
  it("estima perda considerando pacotes Opus de 20 ms e silêncio final", () => {
    expect(
      estimatePacketLossPercent({
        durationMs: 2_000,
        receivedPackets: 40,
        trailingSilenceMs: 1_000,
      }),
    ).toBe(20);
  });

  it("não informa perda negativa quando chegam mais pacotes que o esperado", () => {
    expect(
      estimatePacketLossPercent({
        durationMs: 1_000,
        receivedPackets: 60,
        trailingSilenceMs: 0,
      }),
    ).toBe(0);
  });

  it("calcula o uso de CPU como percentual equivalente a um núcleo", () => {
    expect(
      calculateProcessCpuPercent({
        cpuUsage: { system: 100_000, user: 400_000 },
        elapsedMs: 1_000,
      }),
    ).toBe(50);
  });

  it("retorna zero quando não existe duração mensurável", () => {
    expect(
      estimatePacketLossPercent({
        durationMs: 500,
        receivedPackets: 0,
        trailingSilenceMs: 1_000,
      }),
    ).toBe(0);
    expect(
      calculateProcessCpuPercent({
        cpuUsage: { system: 1, user: 1 },
        elapsedMs: 0,
      }),
    ).toBe(0);
  });
});
