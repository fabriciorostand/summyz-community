import { describe, expect, it, vi } from "vitest";

import { detectLocalHardware } from "../src/local-ai/hardware-detection.js";

const mebibyte = 1_024 ** 2;
const gibibyte = 1_024 ** 3;

describe("detectLocalHardware", () => {
  it("preserva a GPU quando o Compose injeta memória desconhecida como string vazia", async () => {
    const hardware = await detectLocalHardware({
      environment: { SUMMYZ_DETECTED_GPU_VENDOR: "nvidia", SUMMYZ_DETECTED_GPU_MEMORY_BYTES: "" },
      platform: "linux",
      runCommand: async () => "",
    });
    expect(hardware.accelerators).toEqual([
      { id: "injected-0", name: "nvidia GPU", vendor: "nvidia" },
    ]);
  });
  it("usa o hardware validado injetado pelo inicializador do Compose", async () => {
    const profile = await detectLocalHardware({
      environment: {
        SUMMYZ_DETECTED_GPU_MEMORY_BYTES: String(6 * gibibyte),
        SUMMYZ_DETECTED_GPU_NAME: "RTX 2060",
        SUMMYZ_DETECTED_GPU_VENDOR: "nvidia",
      },
      platform: "linux",
      runCommand: async () => {
        throw new Error("commands unavailable");
      },
    });

    expect(profile.accelerators).toEqual([
      { id: "injected-0", memoryBytes: 6 * gibibyte, name: "RTX 2060", vendor: "nvidia" },
    ]);
  });

  it("aceita GPU injetada sem memória ou nome e ignora injeção inválida", async () => {
    const injected = await detectLocalHardware({
      environment: { SUMMYZ_DETECTED_GPU_VENDOR: "intel" },
      platform: "linux",
      runCommand: async () => "",
    });
    expect(injected.accelerators).toEqual([
      { id: "injected-0", name: "intel GPU", vendor: "intel" },
    ]);

    const invalid = await detectLocalHardware({
      environment: { SUMMYZ_DETECTED_GPU_VENDOR: "invalid" },
      platform: "linux",
      runCommand: async () => "",
    });
    expect(invalid.accelerators).toEqual([]);
  });

  it("detecta NVIDIA e preserva a VRAM informada pelo driver", async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === "nvidia-smi") return "0, NVIDIA GeForce RTX 2060, 6144\n";
      return JSON.stringify([
        {
          AdapterRAM: 4_294_967_296,
          Name: "NVIDIA GeForce RTX 2060",
          PNPDeviceID: "PCI\\VEN_10DE&DEV_1F08",
        },
        {
          AdapterRAM: 1_073_741_824,
          Name: "Intel UHD Graphics",
          PNPDeviceID: "PCI\\VEN_8086&DEV_1234",
        },
      ]);
    });

    await expect(
      detectLocalHardware({
        cpuCores: 12,
        memoryBytes: 16 * 1_024 ** 3,
        platform: "win32",
        runCommand,
      }),
    ).resolves.toMatchObject({
      accelerators: [
        { memoryBytes: 6_144 * mebibyte, name: "NVIDIA GeForce RTX 2060", vendor: "nvidia" },
        { name: "Intel UHD Graphics", vendor: "intel" },
      ],
      cpuCores: 12,
    });
  });

  it("detecta AMD no inventário do Windows mesmo sem nvidia-smi", async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === "nvidia-smi") throw new Error("not found");
      return JSON.stringify({
        AdapterRAM: 8_589_934_592,
        Name: "AMD Radeon RX 7600",
        PNPDeviceID: "PCI\\VEN_1002&DEV_7480",
      });
    });

    const hardware = await detectLocalHardware({
      cpuCores: 8,
      memoryBytes: 16 * 1_024 ** 3,
      platform: "win32",
      runCommand,
    });

    expect(hardware.accelerators).toEqual([
      expect.objectContaining({ name: "AMD Radeon RX 7600", vendor: "amd" }),
    ]);
  });

  it("detecta fornecedores conhecidos pelo lspci no Linux", async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === "nvidia-smi") throw new Error("not found");
      return [
        '03:00.0 "VGA compatible controller" "Advanced Micro Devices, Inc. [AMD/ATI]" "Navi 31"',
        '00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics 770"',
      ].join("\n");
    });

    const hardware = await detectLocalHardware({
      cpuCores: 8,
      memoryBytes: 16 * 1_024 ** 3,
      platform: "linux",
      runCommand,
    });

    expect(hardware.accelerators).toEqual([
      expect.objectContaining({ vendor: "amd" }),
      expect.objectContaining({ vendor: "intel" }),
    ]);
  });

  it("continua com perfil CPU quando ferramentas externas não existem", async () => {
    const hardware = await detectLocalHardware({
      cpuCores: 4,
      memoryBytes: 8 * 1_024 ** 3,
      platform: "linux",
      runCommand: vi.fn(async () => {
        throw new Error("not found");
      }),
    });

    expect(hardware).toEqual({ accelerators: [], cpuCores: 4, memoryBytes: 8 * 1_024 ** 3 });
  });

  it("detecta Apple Metal e fabricante desconhecido no macOS", async () => {
    const runCommand = vi.fn(async (command: string) => {
      if (command === "system_profiler") {
        return JSON.stringify({
          SPDisplaysDataType: [
            { _name: "Apple M4", spdisplays_vendor: "Apple" },
            { _name: "External Adapter" },
          ],
        });
      }
      throw new Error("nvidia-smi unavailable");
    });

    const profile = await detectLocalHardware({ platform: "darwin", runCommand });

    expect(profile.accelerators).toEqual([
      { id: "mac-0", name: "Apple M4", vendor: "apple" },
      { id: "mac-1", name: "External Adapter", vendor: "unknown" },
    ]);
  });

  it("ignora respostas malformadas dos adaptadores", async () => {
    const windows = await detectLocalHardware({
      platform: "win32",
      runCommand: async (command) => (command === "powershell.exe" ? "{}" : "malformed"),
    });
    const mac = await detectLocalHardware({
      platform: "darwin",
      runCommand: async (command) => (command === "system_profiler" ? "{}" : "malformed"),
    });

    expect(windows.accelerators).toEqual([]);
    expect(mac.accelerators).toEqual([]);
  });
});
