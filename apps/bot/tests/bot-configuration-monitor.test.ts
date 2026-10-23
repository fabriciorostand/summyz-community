import { describe, expect, it, vi } from "vitest";
import { BotConfigurationMonitor } from "../src/bot-configuration-monitor.js";

describe("BotConfigurationMonitor", () => {
  it("requests one restart when the stored bot configuration changes", async () => {
    const readVersion = vi.fn().mockResolvedValueOnce("version-1").mockResolvedValue("version-2");
    const onChanged = vi.fn(async () => undefined);
    const onError = vi.fn();
    const monitor = new BotConfigurationMonitor({
      expectedVersion: "version-1",
      onChanged,
      onError,
      readVersion,
    });

    await monitor.check();
    await monitor.check();
    await monitor.check();

    expect(onChanged).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(readVersion).toHaveBeenCalledTimes(2);
  });

  it("reports transient database errors and retries the next check", async () => {
    const readVersion = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce("version-2");
    const onChanged = vi.fn(async () => undefined);
    const onError = vi.fn();
    const monitor = new BotConfigurationMonitor({
      expectedVersion: "version-1",
      onChanged,
      onError,
      readVersion,
    });

    await monitor.check();
    await monitor.check();

    expect(onError).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("does not overlap polls and does not create a second timer", async () => {
    let releaseRead: ((version: string) => void) | undefined;
    const readVersion = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseRead = resolve;
        }),
    );
    const monitor = new BotConfigurationMonitor({
      expectedVersion: "version-1",
      onChanged: vi.fn(async () => undefined),
      onError: vi.fn(),
      readVersion,
    });
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      monitor.start();
      monitor.start();
      expect(setIntervalSpy).toHaveBeenCalledOnce();

      const first = monitor.check();
      await monitor.check();
      expect(readVersion).toHaveBeenCalledOnce();
      releaseRead?.("version-1");
      await first;

      monitor.stop();
      monitor.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
    } finally {
      monitor.stop();
      setIntervalSpy.mockRestore();
    }
  });
});
