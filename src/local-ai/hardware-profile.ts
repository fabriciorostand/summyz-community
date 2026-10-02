import { availableParallelism, totalmem } from "node:os";

export type GpuVendor = "amd" | "intel" | "nvidia" | "unknown";

export interface GraphicsAccelerator {
  id: string;
  memoryBytes?: number;
  name: string;
  vendor: GpuVendor;
}

export interface LocalHardwareProfile {
  ollamaGpuVendor?: "amd" | "nvidia";
  gpuAvailability?: Readonly<Partial<Record<"ollama" | "faster-whisper", boolean>>>;
  accelerators?: readonly GraphicsAccelerator[];
  cpuCores: number;
  gpuMemoryBytes?: number;
  memoryBytes: number;
}

export function limitHardwareResources(
  hardware: LocalHardwareProfile,
  exposed: { cpuCores: number; memoryBytes: number } = {
    cpuCores: availableParallelism(),
    memoryBytes: totalmem(),
  },
): LocalHardwareProfile {
  return {
    ...hardware,
    cpuCores: Math.min(hardware.cpuCores, exposed.cpuCores),
    memoryBytes: Math.min(hardware.memoryBytes, exposed.memoryBytes),
  };
}
