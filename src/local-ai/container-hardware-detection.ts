import { readFile } from "node:fs/promises";
import { availableParallelism, cpus, totalmem } from "node:os";
import { z } from "zod";
import { hardwareProfileSchema } from "./hardware-snapshot.js";

export function readHardwareSource(environment: NodeJS.ProcessEnv): "host" | "container" {
  return z.enum(["host", "container"]).default("host").parse(environment.SUMMYZ_HARDWARE_SOURCE);
}

async function readCgroupFile(
  name: "cpu.max" | "cpuset.cpus.effective",
): Promise<string | undefined> {
  try {
    return await readFile(`/sys/fs/cgroup/${name}`, "utf8");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function countCpuSet(value: string): number {
  const ranges = value
    .trim()
    .split(",")
    .map((range) => {
      const match = /^(\d+)(?:-(\d+))?$/.exec(range);
      if (match === null) throw new Error("invalid_cpu_affinity");
      const start = Number(match[1]);
      const end = Number(match[2] ?? match[1]);
      if (end < start || end >= 65536) throw new Error("invalid_cpu_affinity");
      return { start, end };
    })
    .sort((left, right) => left.start - right.start);
  let previousEnd = -1;
  let count = 0;
  for (const { start, end } of ranges) {
    if (start <= previousEnd) throw new Error("invalid_cpu_affinity");
    count += end - start + 1;
    previousEnd = end;
  }
  return count;
}

export async function readContainerResources(
  options: {
    cpuCores: number;
    memoryBytes: number;
    constrainedMemoryBytes: number;
    readCpuLimit(): Promise<string | undefined>;
    readCpuAffinity?(): Promise<string | undefined>;
  } = {
    cpuCores: cpus().length,
    memoryBytes: totalmem(),
    constrainedMemoryBytes: process.constrainedMemory(),
    readCpuLimit: () => readCgroupFile("cpu.max"),
    readCpuAffinity: () => readCgroupFile("cpuset.cpus.effective"),
  },
): Promise<{ cpuCores: number; memoryBytes: number }> {
  let cpuCores = options.cpuCores;
  if (options.readCpuAffinity !== undefined) {
    const affinity = await options.readCpuAffinity();
    cpuCores = Math.min(
      cpuCores,
      affinity === undefined ? availableParallelism() : countCpuSet(affinity),
    );
  }
  const limit = await options.readCpuLimit();
  if (limit !== undefined) {
    const match = /^(max|[1-9]\d*)\s+([1-9]\d*)$/.exec(limit.trim());
    if (match === null) throw new Error("invalid_cpu_limit");
    const quota = match[1];
    const period = Number(match[2]);
    if (!Number.isSafeInteger(period)) throw new Error("invalid_cpu_limit");
    if (quota !== "max") {
      const quotaValue = Number(quota);
      if (!Number.isSafeInteger(quotaValue)) throw new Error("invalid_cpu_limit");
      cpuCores = Math.min(cpuCores, quotaValue / period);
    }
  }
  const constrained = z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(options.constrainedMemoryBytes);
  const memoryBytes =
    constrained > 0 ? Math.min(options.memoryBytes, constrained) : options.memoryBytes;
  const validated = hardwareProfileSchema.parse({ cpuCores, memoryBytes });
  return { cpuCores: validated.cpuCores, memoryBytes: validated.memoryBytes };
}

const gpuInventorySchema = z
  .object({
    cudaDevices: z.number().int().nonnegative().max(128),
    accelerators: hardwareProfileSchema.shape.accelerators,
  })
  .strict()
  .refine(
    (value) =>
      value.cudaDevices === value.accelerators.length &&
      value.accelerators.every((gpu) => gpu.vendor === "nvidia") &&
      new Set(value.accelerators.map((gpu) => gpu.id)).size === value.accelerators.length,
  );

async function requestProvider(request: typeof fetch, url: string): Promise<Response | undefined> {
  try {
    return await request(url, { signal: AbortSignal.timeout(5_000) });
  } catch {
    // Optional GPU services can be absent while CPU providers remain available.
    return undefined;
  }
}

export async function detectContainerHardware(
  options: {
    environment?: NodeJS.ProcessEnv;
    readResources?: typeof readContainerResources;
    request?: typeof fetch;
  } = {},
) {
  const resources = await (options.readResources ?? readContainerResources)();
  const environment = options.environment ?? process.env;
  const request = options.request ?? fetch;
  const vendor = z
    .enum(["nvidia", "amd", "intel", "unknown"])
    .optional()
    .parse(environment.SUMMYZ_DETECTED_GPU_VENDOR || undefined);
  if (vendor === "amd") return detectOllamaGpu(request, resources, vendor);
  if (vendor !== "nvidia") return hardwareProfileSchema.parse({ ...resources, accelerators: [] });
  const response = await requestProvider(
    request,
    "http://faster-whisper-gpu:8000/hardware/inventory",
  );
  if (response?.ok) {
    const inventory = gpuInventorySchema.parse(await response.json());
    return hardwareProfileSchema.parse({ ...resources, accelerators: inventory.accelerators });
  }
  if (response !== undefined && response.status !== 404)
    throw new Error("gpu_inventory_unavailable");
  return detectOllamaGpu(request, resources, vendor);
}

async function detectOllamaGpu(
  request: typeof fetch,
  resources: { cpuCores: number; memoryBytes: number },
  vendor: "nvidia" | "amd",
) {
  const ollama = await requestProvider(request, "http://ollama-gpu:11434/api/version");
  if (ollama?.ok) {
    z.object({ version: z.string().min(1) }).parse(await ollama.json());
    return hardwareProfileSchema.parse({
      ...resources,
      accelerators: [
        { id: `${vendor}-runtime`, name: vendor === "amd" ? "AMD GPU" : "NVIDIA GPU", vendor },
      ],
    });
  }
  return hardwareProfileSchema.parse({ ...resources, accelerators: [] });
}
