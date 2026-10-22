import type { GpuVendor, GraphicsAccelerator, LocalHardwareProfile } from "./hardware-profile.js";

export type LocalAiDevice = "auto" | "cpu" | "gpu";
export type LocalAiFallback = "cpu" | "none";
export type LocalAiPhase = "refinement" | "summary" | "transcription";

export interface PhaseExecution {
  device: "cpu" | "gpu";
  fallback: LocalAiFallback;
  fallbackApplied: boolean;
  gpuId?: string;
  gpuMemoryBytes?: number;
  gpuVendor?: GpuVendor;
}

export type LocalExecutionPlan = Readonly<Record<LocalAiPhase, PhaseExecution>>;

interface ResolveLocalExecutionPlanInput {
  device: LocalAiDevice;
  devices?: Partial<Record<LocalAiPhase, LocalAiDevice>>;
  enabledPhases?: readonly LocalAiPhase[];
  fallback: LocalAiFallback;
  hardware: LocalHardwareProfile;
}

export function resolveLocalExecutionPlan(
  input: ResolveLocalExecutionPlanInput,
): LocalExecutionPlan {
  const fallback = input.device === "cpu" ? "none" : input.fallback;
  const enabledPhases = new Set<LocalAiPhase>(
    input.enabledPhases ?? ["refinement", "summary", "transcription"],
  );
  return {
    refinement: enabledPhases.has("refinement")
      ? resolvePhase(
          "refinement",
          input.devices?.refinement ?? input.device,
          fallback,
          input.hardware,
        )
      : disabledPhase(),
    summary: enabledPhases.has("summary")
      ? resolvePhase("summary", input.devices?.summary ?? input.device, fallback, input.hardware)
      : disabledPhase(),
    transcription: enabledPhases.has("transcription")
      ? resolvePhase(
          "transcription",
          input.devices?.transcription ?? input.device,
          fallback,
          input.hardware,
        )
      : disabledPhase(),
  };
}

function disabledPhase(): PhaseExecution {
  return { device: "cpu", fallback: "none", fallbackApplied: false };
}

function resolvePhase(
  phase: LocalAiPhase,
  preference: LocalAiDevice,
  fallback: LocalAiFallback,
  hardware: LocalHardwareProfile,
): PhaseExecution {
  if (preference === "cpu") {
    return { device: "cpu", fallback: "none", fallbackApplied: false };
  }

  const provider = phase === "transcription" ? "faster-whisper" : "ollama";
  const gpu =
    hardware.gpuAvailability?.[provider] === false
      ? undefined
      : selectBestCompatibleGpu(phase, hardware.accelerators ?? [], hardware.ollamaGpuVendor);
  if (gpu !== undefined) return gpuPhase(gpu, fallback);

  if (preference === "auto") {
    return { device: "cpu", fallback, fallbackApplied: false };
  }
  if (fallback === "cpu") return { device: "cpu", fallback, fallbackApplied: true };
  throw new Error(`${phase} requires a compatible GPU, but none was detected`);
}

function gpuPhase(gpu: GraphicsAccelerator, fallback: LocalAiFallback): PhaseExecution {
  return {
    device: "gpu",
    fallback,
    fallbackApplied: false,
    gpuId: gpu.id,
    ...(gpu.memoryBytes === undefined ? {} : { gpuMemoryBytes: gpu.memoryBytes }),
    gpuVendor: gpu.vendor,
  };
}

function selectBestCompatibleGpu(
  phase: LocalAiPhase,
  accelerators: readonly GraphicsAccelerator[],
  ollamaVendor: "amd" | "nvidia" | undefined,
): GraphicsAccelerator | undefined {
  return accelerators
    .filter((accelerator) => accelerator.vendor === "nvidia" || accelerator.vendor === "amd")
    .filter((accelerator) => phase !== "transcription" || accelerator.vendor === "nvidia")
    .filter(
      (accelerator) =>
        phase === "transcription" ||
        ollamaVendor === undefined ||
        accelerator.vendor === ollamaVendor,
    )
    .toSorted((left, right) => (right.memoryBytes ?? 0) - (left.memoryBytes ?? 0))[0];
}
