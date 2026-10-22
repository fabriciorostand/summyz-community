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
