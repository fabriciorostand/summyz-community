import type { PhaseExecution } from "./local-execution-policy.js";

const gibibyte = 1_024 ** 3;

export function resolveFasterWhisperBatchSize(
  configured: "auto" | number,
  model: string,
  execution: PhaseExecution,
  concurrency: number,
): number {
  if (configured !== "auto") return configured;
  if (execution.device !== "gpu") return 0;
  if (execution.gpuMemoryBytes === undefined) return 2;

  const memoryPerWorker = execution.gpuMemoryBytes / Math.max(1, concurrency);
  const modelFactor = getModelFactor(model);
  const adjustedMemoryGibibytes = memoryPerWorker / gibibyte / modelFactor;
  if (adjustedMemoryGibibytes >= 8) return 8;
  if (adjustedMemoryGibibytes >= 5) return 4;
  if (adjustedMemoryGibibytes >= 2) return 2;
  return 0;
}

function getModelFactor(model: string): number {
  const normalized = model.toLowerCase();
  if (normalized.includes("large")) return 2;
  if (normalized.includes("medium")) return 1.5;
  if (normalized.includes("small")) return 1;
  return 0.75;
}
