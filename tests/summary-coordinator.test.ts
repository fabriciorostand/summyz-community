import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { SummaryCoordinator } from "../src/summary/summary-coordinator.js";

const manifest = markManifestCompleted(
  createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    startedAt: "2026-08-17T10:00:00.000Z",
    voiceChannelId: "voice-1",
  }),
  "2026-08-17T10:01:00.000Z",
);

describe("SummaryCoordinator", () => {
  it("impede processamento duplicado e aguarda operações no shutdown", async () => {
    let release: (() => void) | undefined;
    const process = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const coordinator = new SummaryCoordinator({ process }, createLogger("silent"));

    expect(coordinator.start(manifest)).toBe(true);
    expect(coordinator.start(manifest)).toBe(false);
    const shutdown = coordinator.shutdown();
    await new Promise((resolve) => setImmediate(resolve));
    release?.();
    await shutdown;

    expect(process).toHaveBeenCalledOnce();
  });

  it("trata rejeições e libera a reunião para uma retomada", async () => {
    const process = vi.fn(async () => {
      throw new Error("falha de publicação");
    });
    const coordinator = new SummaryCoordinator({ process }, createLogger("silent"));

    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();
    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();

    expect(process).toHaveBeenCalledTimes(2);
  });

  it("trata rejeição externa que não usa Error", async () => {
    const process = vi.fn(() => Promise.reject("falha externa"));
    const coordinator = new SummaryCoordinator({ process }, createLogger("silent"));

    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();
  });
});
