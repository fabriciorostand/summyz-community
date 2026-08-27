import type { LocalHardwareProfile } from "./hardware-profile.js";
import {
  resolveLocalExecutionPlan,
  type LocalAiDevice,
  type LocalAiFallback,
  type LocalAiPhase,
} from "./local-execution-policy.js";

interface SelectComposeAccelerationInput {
  device: LocalAiDevice;
  fallback: LocalAiFallback;
  hardware: LocalHardwareProfile;
  phases: readonly LocalAiPhase[];
  platform: NodeJS.Platform;
}

export interface ComposeAccelerationSelection {
  environment: NodeJS.ProcessEnv;
  overlays: string[];
}

export function selectComposeAcceleration(
  input: SelectComposeAccelerationInput,
): ComposeAccelerationSelection {
  if (input.device === "cpu" || input.phases.length === 0) {
    return { environment: {}, overlays: [] };
  }

  const plan = resolveLocalExecutionPlan({
    device: input.device,
    enabledPhases: input.phases,
    fallback: input.fallback,
    hardware: input.hardware,
  });
  const selectedGpus = input.phases.flatMap((phase) => {
    const execution = plan[phase];
    return execution.device === "gpu" && execution.gpuId !== undefined ? [execution] : [];
  });
  const [firstGpu, ...remainingGpus] = selectedGpus;
  if (firstGpu === undefined) return { environment: {}, overlays: [] };

  const vendors = new Set(selectedGpus.map((execution) => execution.gpuVendor));
  const overlays: string[] = [];
  if (vendors.has("nvidia")) overlays.push("docker-compose.nvidia.yaml");
  if (vendors.has("amd")) {
    if (input.platform !== "linux") {
      if (input.fallback === "cpu") return { environment: {}, overlays: [] };
      throw new Error("AMD GPU acceleration through Docker is unavailable on Windows and macOS");
    }
    overlays.push("docker-compose.amd.yaml");
  }
  const unsupportedVendor = [...vendors].find(
    (vendor) => vendor !== undefined && vendor !== "amd" && vendor !== "nvidia",
  );
  if (unsupportedVendor !== undefined) {
    if (input.fallback === "cpu") return { environment: {}, overlays: [] };
    throw new Error(
      `GPU vendor ${unsupportedVendor} has no supported Compose acceleration profile`,
    );
  }

  const primary = remainingGpus.reduce(
    (selected, candidate) =>
      (candidate.gpuMemoryBytes ?? 0) > (selected.gpuMemoryBytes ?? 0) ? candidate : selected,
    firstGpu,
  );
  return {
    environment: {
      ...(primary.gpuMemoryBytes === undefined
        ? {}
        : { SUMMYZ_DETECTED_GPU_MEMORY_BYTES: String(primary.gpuMemoryBytes) }),
      SUMMYZ_DETECTED_GPU_NAME: primary.gpuId,
      SUMMYZ_DETECTED_GPU_VENDOR: primary.gpuVendor,
    },
    overlays,
  };
}
