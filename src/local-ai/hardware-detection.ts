import { execFile } from "node:child_process";
import { availableParallelism, totalmem } from "node:os";
import { promisify } from "node:util";

import { z } from "zod";

import type { GpuVendor, GraphicsAccelerator, LocalHardwareProfile } from "./hardware-profile.js";

type RunCommand = (command: string, args: readonly string[]) => Promise<string>;

interface DetectLocalHardwareOptions {
  cpuCores?: number;
  environment?: NodeJS.ProcessEnv;
  memoryBytes?: number;
  platform?: NodeJS.Platform;
  runCommand?: RunCommand;
}

const execFileAsync = promisify(execFile);
const windowsAdapterSchema = z.object({
  AdapterRAM: z.union([z.number(), z.string(), z.null()]).optional(),
  Name: z.string().min(1),
  PNPDeviceID: z.string().optional(),
});
const injectedGpuSchema = z.object({
  SUMMYZ_DETECTED_GPU_MEMORY_BYTES: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  SUMMYZ_DETECTED_GPU_NAME: z.string().min(1).max(200).optional(),
  SUMMYZ_DETECTED_GPU_VENDOR: z.enum(["amd", "apple", "intel", "nvidia", "unknown"]),
});

export async function detectLocalHardware(
  options: DetectLocalHardwareOptions = {},
): Promise<LocalHardwareProfile> {
  const runCommand = options.runCommand ?? runExternalCommand;
  const platform = options.platform ?? process.platform;
  const detected = [
    ...detectInjectedAdapter(options.environment ?? process.env),
    ...(await detectNvidia(runCommand)),
    ...(await detectPlatformAdapters(platform, runCommand)),
  ];

  return hardwareProfile(options, detected);
}

async function detectPlatformAdapters(
  platform: NodeJS.Platform,
  runCommand: RunCommand,
): Promise<GraphicsAccelerator[]> {
  if (platform === "win32") {
    return detectWindowsAdapters(runCommand);
  }
  if (platform === "darwin") return detectMacAdapters(runCommand);
  return detectLinuxAdapters(runCommand);
}

function hardwareProfile(
  options: DetectLocalHardwareOptions,
  detected: readonly GraphicsAccelerator[],
): LocalHardwareProfile {
  return {
    accelerators: mergeAccelerators(detected),
    cpuCores: options.cpuCores ?? availableParallelism(),
    memoryBytes: options.memoryBytes ?? totalmem(),
  };
}

function detectInjectedAdapter(environment: NodeJS.ProcessEnv): GraphicsAccelerator[] {
  const parsed = injectedGpuSchema.safeParse(environment);
  if (!parsed.success) return [];
  return [
    {
      id: "injected-0",
      ...(parsed.data.SUMMYZ_DETECTED_GPU_MEMORY_BYTES === undefined
        ? {}
        : { memoryBytes: parsed.data.SUMMYZ_DETECTED_GPU_MEMORY_BYTES }),
      name: parsed.data.SUMMYZ_DETECTED_GPU_NAME ?? `${parsed.data.SUMMYZ_DETECTED_GPU_VENDOR} GPU`,
      vendor: parsed.data.SUMMYZ_DETECTED_GPU_VENDOR,
    },
  ];
}

async function runExternalCommand(command: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
    windowsHide: true,
  });
  return result.stdout;
}

async function detectNvidia(runCommand: RunCommand): Promise<GraphicsAccelerator[]> {
  try {
    const output = await runCommand("nvidia-smi", [
      "--query-gpu=index,name,memory.total",
      "--format=csv,noheader,nounits",
    ]);
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        const [index, name, memoryMebibytes] = line.split(",").map((value) => value.trim());
        const memory = Number(memoryMebibytes);
        if (index === undefined || name === undefined || name.length === 0) return [];
        return [
          {
            id: `nvidia-${index}`,
            ...(Number.isFinite(memory) && memory > 0 ? { memoryBytes: memory * 1_024 ** 2 } : {}),
            name,
            vendor: "nvidia" as const,
          },
        ];
      });
  } catch {
    return [];
  }
}

async function detectWindowsAdapters(runCommand: RunCommand): Promise<GraphicsAccelerator[]> {
  try {
    const output = await runCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,AdapterRAM | ConvertTo-Json -Compress",
    ]);
    const parsed: unknown = JSON.parse(output);
    const adapters = z
      .array(windowsAdapterSchema)
      .safeParse(Array.isArray(parsed) ? parsed : [parsed]);
    if (!adapters.success) return [];
    return adapters.data.map((adapter, index) => {
      const memory = Number(adapter.AdapterRAM);
      return {
        id: adapter.PNPDeviceID ?? `windows-${String(index)}`,
        ...(Number.isFinite(memory) && memory > 0 ? { memoryBytes: memory } : {}),
        name: adapter.Name,
        vendor: identifyVendor(`${adapter.PNPDeviceID ?? ""} ${adapter.Name}`),
      };
    });
  } catch {
    return [];
  }
}

async function detectLinuxAdapters(runCommand: RunCommand): Promise<GraphicsAccelerator[]> {
  try {
    const output = await runCommand("lspci", ["-mm", "-nn"]);
    return output.split(/\r?\n/u).flatMap((line) => {
      const fields = [...line.matchAll(/"([^"]*)"/gu)].map((match) => match[1] ?? "");
      const [deviceClass, vendor, name] = fields;
      if (deviceClass === undefined || !/(?:VGA|3D|Display)/iu.test(deviceClass)) return [];
      const id = line.split(/\s/u)[0];
      if (id === undefined || vendor === undefined || name === undefined) return [];
      return [{ id, name: `${vendor} ${name}`.trim(), vendor: identifyVendor(vendor) }];
    });
  } catch {
    return [];
  }
}

async function detectMacAdapters(runCommand: RunCommand): Promise<GraphicsAccelerator[]> {
  try {
    const output = await runCommand("system_profiler", ["SPDisplaysDataType", "-json"]);
    const parsed = z
      .object({
        SPDisplaysDataType: z.array(
          z.object({
            _name: z.string().min(1),
            spdisplays_vendor: z.string().optional(),
            sppci_device_type: z.string().optional(),
          }),
        ),
      })
      .safeParse(JSON.parse(output) as unknown);
    if (!parsed.success) return [];
    return parsed.data.SPDisplaysDataType.map((adapter, index) => ({
      id: `mac-${String(index)}`,
      name: adapter._name,
      vendor: identifyVendor(
        `${adapter.spdisplays_vendor ?? ""} ${adapter.sppci_device_type ?? ""} ${adapter._name}`,
      ),
    }));
  } catch {
    return [];
  }
}

function identifyVendor(value: string): GpuVendor {
  if (/(?:VEN_10DE|NVIDIA)/iu.test(value)) return "nvidia";
  if (/(?:VEN_1002|\bAMD\b|\bATI\b|\bRadeon\b)/iu.test(value)) return "amd";
  if (/(?:VEN_8086|Intel)/iu.test(value)) return "intel";
  if (/(?:Apple|Metal)/iu.test(value)) return "apple";
  return "unknown";
}

function mergeAccelerators(accelerators: readonly GraphicsAccelerator[]): GraphicsAccelerator[] {
  const merged = new Map<string, GraphicsAccelerator>();
  for (const accelerator of accelerators) {
    const key = `${accelerator.vendor}:${normalizeName(accelerator.name)}`;
    const existing = merged.get(key);
    if (existing === undefined || (accelerator.memoryBytes ?? 0) > (existing.memoryBytes ?? 0)) {
      merged.set(key, accelerator);
    }
  }
  return [...merged.values()];
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
}
