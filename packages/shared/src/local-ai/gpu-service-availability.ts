import { z } from "zod";
import type { LocalHardwareProfile } from "./hardware-profile.js";

export async function readGpuServiceAvailability(
  hardware: LocalHardwareProfile,
  request: typeof fetch = fetch,
): Promise<LocalHardwareProfile> {
  const vendors = hardware.accelerators?.map((gpu) => gpu.vendor) ?? [];
  const configured = z.enum(["amd", "nvidia"]).safeParse(process.env.SUMMYZ_DETECTED_GPU_VENDOR);
  const ollamaGpuVendor = configured.success ? configured.data : undefined;
  const [ollama, whisper] = await Promise.all([
    vendors.some((vendor) =>
      ollamaGpuVendor === undefined
        ? vendor === "nvidia" || vendor === "amd"
        : vendor === ollamaGpuVendor,
    )
      ? probe(
          "http://ollama-gpu:11434/api/version",
          z.object({ version: z.string().min(1) }),
          request,
        )
      : false,
    vendors.includes("nvidia")
      ? probe(
          "http://faster-whisper-gpu:8000/hardware",
          z.object({ cudaDevices: z.number().int().positive() }),
          request,
        )
      : false,
  ]);
  return {
    ...hardware,
    ...(ollamaGpuVendor === undefined ? {} : { ollamaGpuVendor }),
    gpuAvailability: { ollama, "faster-whisper": whisper },
  };
}

async function probe(url: string, schema: z.ZodType, request: typeof fetch): Promise<boolean> {
  try {
    const response = await request(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok && schema.safeParse(await response.json()).success;
  } catch {
    // A missing service or invalid response makes this provider unavailable.
    return false;
  }
}
