import type { LocalHardwareProfile } from "./local-ai/hardware-profile.js";

export type AiProfileCompatibilityStatus =
  | "above_recommended"
  | "compatible"
  | "incompatible"
  | "recommended"
  | "unknown";

interface AssessModelCompatibilityInput {
  device?: "cpu" | "gpu";
  hardware: LocalHardwareProfile;
  model: string;
  phase: "refinement" | "summary" | "transcription";
  provider: "faster-whisper" | "ollama" | "openrouter";
}

interface CatalogEntry {
  gpuMemoryBytes?: number;
  memoryBytes: number;
  minimumCpuCores: number;
  model: string;
  phase: AssessModelCompatibilityInput["phase"];
  provider: AssessModelCompatibilityInput["provider"];
  recommendedGpuMemoryBytes?: readonly [minimum: number, maximum: number];
  supportedGpuVendors?: readonly string[];
}

const gibibyte = 1_024 ** 3;
const catalog: readonly CatalogEntry[] = [
  whisper("tiny", 2, 1, 1),
  whisper("base", 3, 2, 1.5),
  whisper("small", 5, 4, 2.5),
  whisper("medium", 10, 8, 3.5, [3.5, 6]),
  whisper("large-v3", 18, 12, 6, [6, Number.POSITIVE_INFINITY]),
  ollama("qwen3:1.7b", "refinement", 4, 2, 2),
  ollama("qwen3:4b-instruct-2507-q4_K_M", "refinement", 7, 4, 4),
  ollama("qwen3:4b-instruct-2507-q4_K_M", "summary", 7, 4, 4, [3.5, 7]),
  ollama("qwen3:8b", "refinement", 11, 8, 7),
  ollama("qwen3:8b", "summary", 11, 8, 7, [7, 11]),
  ollama("qwen3:14b", "summary", 20, 12, 11, [11, Number.POSITIVE_INFINITY]),
];

export function assessModelCompatibility(
  input: AssessModelCompatibilityInput,
): AiProfileCompatibilityStatus {
  if (input.provider === "openrouter") return "unknown";
  const entry = findCatalogEntry(input);
  if (entry === undefined) return "unknown";
  const device = input.device ?? (input.hardware.gpuMemoryBytes === undefined ? "cpu" : "gpu");
  if (device === "gpu") return assessGpuCompatibility(input.hardware, entry);
  return assessCpuCompatibility(input.hardware, entry);
}

function findCatalogEntry(input: AssessModelCompatibilityInput): CatalogEntry | undefined {
  return catalog.find(
    (candidate) =>
      candidate.model === input.model &&
      candidate.phase === input.phase &&
      candidate.provider === input.provider,
  );
}

function assessGpuCompatibility(
  hardware: LocalHardwareProfile,
  entry: CatalogEntry,
): AiProfileCompatibilityStatus {
  const accelerators = hardware.accelerators ?? [];
  if (!hasSupportedGpuVendor(accelerators, entry.supportedGpuVendors)) return "incompatible";
  const available = hardware.gpuMemoryBytes ?? 0;
  if (available < (entry.gpuMemoryBytes ?? entry.memoryBytes)) return "above_recommended";
  return isRecommendedGpuMemory(available, entry.recommendedGpuMemoryBytes)
    ? "recommended"
    : "compatible";
}

function hasSupportedGpuVendor(
  accelerators: NonNullable<LocalHardwareProfile["accelerators"]>,
  supportedVendors: readonly string[] | undefined,
): boolean {
  if (supportedVendors === undefined) return true;
  return accelerators.some((gpu) => supportedVendors.includes(gpu.vendor));
}

function isRecommendedGpuMemory(
  available: number,
  range: CatalogEntry["recommendedGpuMemoryBytes"],
): boolean {
  if (range === undefined) return false;
  return available >= range[0] && available < range[1];
}

function assessCpuCompatibility(
  hardware: LocalHardwareProfile,
  entry: CatalogEntry,
): AiProfileCompatibilityStatus {
  if (
    hardware.memoryBytes * 0.75 < entry.memoryBytes ||
    hardware.cpuCores < entry.minimumCpuCores
  ) {
    return "above_recommended";
  }
  return "compatible";
}

function whisper(
  model: string,
  memoryGiB: number,
  minimumCpuCores: number,
  gpuMemoryGiB: number,
  recommendedGpuGiB?: readonly [number, number],
): CatalogEntry {
  return {
    gpuMemoryBytes: gpuMemoryGiB * gibibyte,
    memoryBytes: memoryGiB * gibibyte,
    minimumCpuCores,
    model,
    phase: "transcription",
    provider: "faster-whisper",
    ...(recommendedGpuGiB === undefined
      ? {}
      : {
          recommendedGpuMemoryBytes: [
            recommendedGpuGiB[0] * gibibyte,
            recommendedGpuGiB[1] * gibibyte,
          ] as const,
        }),
    supportedGpuVendors: ["nvidia"],
  };
}

function ollama(
  model: string,
  phase: "refinement" | "summary",
  memoryGiB: number,
  minimumCpuCores: number,
  gpuMemoryGiB: number,
  recommendedGpuGiB?: readonly [number, number],
): CatalogEntry {
  return {
    gpuMemoryBytes: gpuMemoryGiB * gibibyte,
    memoryBytes: memoryGiB * gibibyte,
    minimumCpuCores,
    model,
    phase,
    provider: "ollama",
    ...(recommendedGpuGiB === undefined
      ? {}
      : {
          recommendedGpuMemoryBytes: [
            recommendedGpuGiB[0] * gibibyte,
            recommendedGpuGiB[1] * gibibyte,
          ] as const,
        }),
    supportedGpuVendors: ["amd", "nvidia"],
  };
}
