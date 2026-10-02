import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("host hardware agent packaging", () => {
  it("prepares the Linux system unit through the launcher", async () => {
    const launcher = await readFile("summyz-community", "utf8");
    expect(launcher.includes("configure_hardware_agent install")).toBe(true);
    expect(launcher.includes("configure_hardware_agent stop")).toBe(true);
  });
  it("prepares the Windows detector through the launcher and disables it on down", async () => {
    const launcher = await readFile("summyz-community.ps1", "utf8");
    expect(launcher).toContain('Invoke-HardwareAgentSetup -Action "install"');
    expect(launcher).toContain('Invoke-HardwareAgentSetup -Action "stop"');
    expect(launcher).toContain("-WindowStyle Hidden");
  });
  it("uses native device events instead of scheduled inventory scans", async () => {
    const windows = await readFile("scripts/hardware-agent.ps1", "utf8");
    const linux = await readFile("scripts/hardware-agent", "utf8");
    expect(windows).toContain("Win32_DeviceChangeEvent");
    expect(windows).toContain("Wait-Event");
    expect(windows).not.toMatch(/WITHIN\s+\d|Set-Interval/i);
    expect(linux).toContain("udevadm monitor --udev");
    expect(linux).toContain("read -r event");
    expect(linux).not.toContain("watch -n");
    expect(windows).toContain("summyz-hardware/v1:");
    expect(linux).toContain("summyz-hardware/v1:");
  });
  it("starts at boot with a limited Windows identity and a Linux system unit", async () => {
    const windows = await readFile("scripts/install-hardware-agent.ps1", "utf8");
    const linux = await readFile("scripts/install-hardware-agent", "utf8");
    expect(windows).toContain("New-ScheduledTaskTrigger -AtStartup");
    expect(windows).toContain("-RunLevel Limited");
    expect(windows).toContain("-UserId $InstallationUser");
    expect(await readFile("summyz-community.ps1", "utf8")).toContain('"-InstallationUser"');
    expect(windows).not.toContain("-UserId SYSTEM");
    expect(linux).toContain("WantedBy=multi-user.target");
    expect(linux).toContain("systemctl enable --now");
    expect(linux).toContain("NoNewPrivileges=true");
  });
});
