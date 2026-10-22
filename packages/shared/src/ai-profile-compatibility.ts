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
  modelSizeBytes?: number | null | undefined;
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
  const entry = findCatalogEntry(input) ?? estimateCatalogEntry(input);
  if (entry === undefined) return "unknown";
  const device = input.device ?? (input.hardware.gpuMemoryBytes === undefined ? "cpu" : "gpu");
  if (device === "gpu") return assessGpuCompatibility(input.hardware, entry);
  return assessBalancedCpuCompatibility(input, entry);
}

function assessBalancedCpuCompatibility(
  input: AssessModelCompatibilityInput,
  entry: CatalogEntry,
): AiProfileCompatibilityStatus {
  const compatibility = assessCpuCompatibility(input.hardware, entry);
  if (compatibility !== "compatible") return compatibility;
  const balanced = selectBalancedCpuModel(input);
  if (balanced?.model === entry.model) return "recommended";
  if (findCatalogEntry(input) === undefined && input.provider === "ollama") {
    const parameters = parameterCount(input.model);
    if (
      parameters !== undefined &&
      parameters <= input.hardware.cpuCores * (input.phase === "summary" ? 1 : 0.75) &&
      entry.memoryBytes <= input.hardware.memoryBytes * 0.6
    )
      return "recommended";
  }
  return compatibility;
}

function selectBalancedCpuModel(input: AssessModelCompatibilityInput): CatalogEntry | undefined {
  return catalog
    .filter(
      (candidate) =>
        candidate.phase === input.phase &&
        candidate.provider === input.provider &&
        candidate.minimumCpuCores <= Math.max(1, Math.floor((input.hardware.cpuCores * 2) / 3)) &&
        candidate.memoryBytes <= input.hardware.memoryBytes * 0.75,
    )
    .toSorted((left, right) => right.memoryBytes - left.memoryBytes)[0];
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

function parameterCount(model: string): number | undefined {
  const match = /(?:^|[:_-])(\d+(?:\.\d+)?)b(?:$|[-_])/iu.exec(model);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function estimateCatalogEntry(input: AssessModelCompatibilityInput): CatalogEntry | undefined {
  const size = input.modelSizeBytes;
  if (size === undefined || size === null || !Number.isFinite(size) || size <= 0) return undefined;
  const parameters = parameterCount(input.model);
  // The catalog's actual weight size captures quantization; reserve additional runtime/context memory.
  return {
    model: input.model,
    provider: input.provider,
    phase: input.phase,
    memoryBytes: size * (input.provider === "ollama" ? 1.5 : 2) + 2 * gibibyte,
    gpuMemoryBytes: size * 1.2 + gibibyte,
    recommendedGpuMemoryBytes: [size * 1.2 + gibibyte, (size * 1.2 + gibibyte) * 1.8],
    minimumCpuCores: parameters === undefined ? 2 : Math.max(2, Math.ceil(parameters / 2)),
    supportedGpuVendors: input.provider === "faster-whisper" ? ["nvidia"] : ["amd", "nvidia"],
  };
}
