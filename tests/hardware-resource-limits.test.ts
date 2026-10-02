import { expect, it } from "vitest";
import { limitHardwareResources } from "../src/local-ai/hardware-profile.js";

it("limits CPU and RAM estimates to resources exposed to the installation without changing GPU inventory", () => {
  const hardware = {
    cpuCores: 32,
    memoryBytes: 64 * 1024 ** 3,
    accelerators: [
      { id: "gpu", name: "GPU", vendor: "nvidia" as const, memoryBytes: 8 * 1024 ** 3 },
    ],
  };
  expect(limitHardwareResources(hardware, { cpuCores: 4, memoryBytes: 8 * 1024 ** 3 })).toEqual({
    ...hardware,
    cpuCores: 4,
    memoryBytes: 8 * 1024 ** 3,
  });
  expect(limitHardwareResources(hardware, { cpuCores: 64, memoryBytes: 128 * 1024 ** 3 })).toEqual(
    hardware,
  );
});
