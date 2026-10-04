import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("launcher hardware packaging", () => {
  it("detects the Linux GPU at launch without host services or a container inventory overlay", async () => {
    const launcher = await readFile("summyz-community", "utf8");
    expect(launcher).not.toMatch(/configure_hardware_agent|install-hardware-agent|sudo|systemctl/);
    expect(launcher).not.toContain("compose.hardware.yaml");
    await expect(access("scripts/hardware-agent")).rejects.toThrow();
    await expect(access("scripts/install-hardware-agent")).rejects.toThrow();
  });
  it("detects the Windows GPU at launch without elevation, tasks, or a container inventory overlay", async () => {
    const launcher = await readFile("summyz-community.ps1", "utf8");
    expect(launcher).not.toMatch(
      /Invoke-HardwareAgentSetup|RunAs|ScheduledTask|WindowsPrincipal|install-hardware-agent/,
    );
    expect(launcher).not.toContain("compose.hardware.yaml");
    await expect(access("scripts/hardware-agent.ps1")).rejects.toThrow();
    await expect(access("scripts/install-hardware-agent.ps1")).rejects.toThrow();
  });
  it("keeps Compose free of the container hardware inventory switch", async () => {
    await expect(access("docker/compose.hardware.yaml")).rejects.toThrow();
    for (const file of [
      "compose.yaml",
      "docker/compose.nvidia.yaml",
      "docker/compose.amd.yaml",
      "docker/compose.public.yaml",
    ])
      expect(await readFile(file, "utf8")).not.toContain("SUMMYZ_HARDWARE_SOURCE");
  });
});
