import type { Logger } from "pino";
import { detectContainerHardware, readContainerResources } from "./container-hardware-detection.js";
import { ContainerHardwareInventory } from "./container-hardware-inventory.js";
import { readGpuServiceAvailability } from "./gpu-service-availability.js";
import { detectLocalHardware } from "./hardware-detection.js";
import { type LocalHardwareProfile, limitHardwareResources } from "./hardware-profile.js";
import type { HardwareStore } from "./hardware-snapshot.js";

type HardwareRuntimeOptions = {
  store: HardwareStore;
  logger: Logger;
  source: "host" | "container";
  detect?: () => Promise<LocalHardwareProfile>;
  readAvailability?: typeof readGpuServiceAvailability;
  closeOnFailure?: () => Promise<void>;
};

export async function initializeHardwareRuntime(options: HardwareRuntimeOptions) {
  try {
    return await createHardwareRuntime(options);
  } catch (error: unknown) {
    if (options.closeOnFailure === undefined) throw error;
    options.logger.fatal(
      { code: "hardware_detection_failed" },
      "Hardware startup preflight failed",
    );
    await options.closeOnFailure().catch(() => {
      options.logger.error("Unable to close PostgreSQL after hardware startup failure");
    });
    throw new Error("hardware_detection_failed");
  }
}

async function createHardwareRuntime(options: HardwareRuntimeOptions) {
  const detect =
    options.detect ??
    (options.source === "container" ? detectContainerHardware : detectLocalHardware);
  const containerInventory =
    options.source === "container"
      ? new ContainerHardwareInventory({ store: options.store, logger: options.logger, detect })
      : undefined;
  const initialHardware =
    containerInventory === undefined
      ? await detect()
      : (await containerInventory.initialize()).hardware;
  const readHardware = async () => {
    const hardware =
      containerInventory === undefined
        ? ((await options.store.read())?.hardware ?? initialHardware)
        : (await containerInventory.read()).hardware;
    const limited =
      options.source === "container"
        ? limitHardwareResources(hardware, await readContainerResources())
        : limitHardwareResources(hardware);
    return (options.readAvailability ?? readGpuServiceAvailability)(limited);
  };
  return {
    initialHardware,
    readHardware,
    ...(containerInventory === undefined ? {} : { containerInventory }),
  };
}
