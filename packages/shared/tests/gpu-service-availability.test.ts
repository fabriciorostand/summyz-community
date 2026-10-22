import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGpuServiceAvailability } from "../src/local-ai/gpu-service-availability.js";

describe("GPU service availability", () => {
  beforeEach(() => vi.stubEnv("SUMMYZ_DETECTED_GPU_VENDOR", undefined));
  afterEach(() => vi.unstubAllEnvs());
  it("keeps the service vendor binding after a hardware replacement", async () => {
    vi.stubEnv("SUMMYZ_DETECTED_GPU_VENDOR", "amd");
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ cudaDevices: 1, version: "0.33.3" }));
    const result = await readGpuServiceAvailability(hardware, request);
    expect(result.ollamaGpuVendor).toBe("amd");
    expect(result.gpuAvailability).toEqual({ ollama: false, "faster-whisper": true });
    expect(request).not.toHaveBeenCalledWith(
      "http://ollama-gpu:11434/api/version",
      expect.any(Object),
    );
    request.mockClear();
    const amd = { ...hardware, accelerators: [{ id: "amd", name: "AMD", vendor: "amd" as const }] };
    expect((await readGpuServiceAvailability(amd, request)).gpuAvailability).toEqual({
      ollama: true,
      "faster-whisper": false,
    });
  });
  const hardware = {
    cpuCores: 8,
    memoryBytes: 16 * 1024 ** 3,
    accelerators: [{ id: "gpu", name: "GPU", vendor: "nvidia" as const }],
  };
  it("reports each service independently and rejects malformed readiness responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).includes("ollama")
          ? Response.json({ version: "0.33.3" })
          : Response.json({ cudaDevices: 0 }),
      );
    expect(await readGpuServiceAvailability(hardware, request)).toEqual({
      ...hardware,
      gpuAvailability: { ollama: true, "faster-whisper": false },
    });
    request.mockRejectedValue(new Error("driver unavailable"));
    expect((await readGpuServiceAvailability(hardware, request)).gpuAvailability).toEqual({
      ollama: false,
      "faster-whisper": false,
    });
  });
  it("never probes GPU services without compatible hardware", async () => {
    const request = vi.fn<typeof fetch>();
    expect(
      (await readGpuServiceAvailability({ cpuCores: 4, memoryBytes: 8 * 1024 ** 3 }, request))
        .gpuAvailability,
    ).toEqual({ ollama: false, "faster-whisper": false });
    expect(request).not.toHaveBeenCalled();
  });
});
