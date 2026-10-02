import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("container hardware packaging", () => {
  it("uses container inventory on Linux without registering a host service", async () => {
    const launcher = await readFile("summyz-community", "utf8");
    expect(launcher).not.toMatch(/configure_hardware_agent|install-hardware-agent|sudo|systemctl/);
    expect(launcher).toContain('"$(uname -s)" != Linux');
    expect(launcher).toContain("docker/compose.hardware.yaml");
    await expect(access("scripts/hardware-agent")).rejects.toThrow();
    await expect(access("scripts/install-hardware-agent")).rejects.toThrow();
  });
  it("uses container inventory on Windows without elevation, tasks, or a resident host detector", async () => {
    const launcher = await readFile("summyz-community.ps1", "utf8");
    expect(launcher).not.toMatch(
      /Invoke-HardwareAgentSetup|RunAs|ScheduledTask|WindowsPrincipal|install-hardware-agent/,
    );
    expect(launcher).not.toContain("SUMMYZ_DETECTED_GPU_MEMORY_BYTES");
    expect(launcher).not.toContain("memory.total");
    expect(launcher).toContain('"docker/compose.hardware.yaml"');
    expect(await readFile("docker/compose.hardware.yaml", "utf8")).toContain(
      "SUMMYZ_HARDWARE_SOURCE: container",
    );
    await expect(access("scripts/hardware-agent.ps1")).rejects.toThrow();
    await expect(access("scripts/install-hardware-agent.ps1")).rejects.toThrow();
    expect(await readFile("compose.yaml", "utf8")).not.toContain("SUMMYZ_HARDWARE_SOURCE");
  });
});
