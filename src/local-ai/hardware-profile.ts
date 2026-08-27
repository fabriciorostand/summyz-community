export type GpuVendor = "amd" | "apple" | "intel" | "nvidia" | "unknown";

export interface GraphicsAccelerator {
  id: string;
  memoryBytes?: number;
  name: string;
  vendor: GpuVendor;
}

export interface LocalHardwareProfile {
  accelerators?: readonly GraphicsAccelerator[];
  cpuCores: number;
  gpuMemoryBytes?: number;
  memoryBytes: number;
}
