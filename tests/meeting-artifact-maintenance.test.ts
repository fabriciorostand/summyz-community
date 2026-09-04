import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { MeetingArtifactMaintenance } from "../src/processing/meeting-artifact-maintenance.js";

describe("MeetingArtifactMaintenance", () => {
  it("reabre versões elegíveis antes de limpar artefatos vencidos", async () => {
    const events: string[] = [];
    const cleanup = vi.fn(async (meetingId: string) => {
      events.push(`cleanup:${meetingId}`);
    });
    const recoverEligibleTranscriptions = vi.fn(async (version: number) => {
      events.push(`recover:${String(version)}`);
      return ["meeting-recovered"];
    });
    const listTerminalMeetingIds = vi.fn(async () => {
      events.push("list-cleanup");
      return ["meeting-expired"];
    });
    const maintenance = new MeetingArtifactMaintenance({
      cleanup,
      logger: createLogger("silent"),
      meetingStore: { listTerminalMeetingIds },
      queue: { recoverEligibleTranscriptions },
      recoveryVersion: 2,
    });

    await maintenance.runOnce();

    expect(events).toEqual(["recover:2", "list-cleanup", "cleanup:meeting-expired"]);
    expect(cleanup).not.toHaveBeenCalledWith("meeting-recovered");
  });

  it("continua executando depois de uma falha periódica e encerra de forma idempotente", async () => {
    vi.useFakeTimers();
    const recoverEligibleTranscriptions = vi
      .fn<(version: number) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue([]);
    const listTerminalMeetingIds = vi.fn(async () => [] as string[]);
    const maintenance = new MeetingArtifactMaintenance({
      cleanup: vi.fn(async () => undefined),
      intervalMs: 10,
      logger: createLogger("silent"),
      meetingStore: { listTerminalMeetingIds },
      queue: { recoverEligibleTranscriptions },
      recoveryVersion: 2,
    });

    maintenance.start();
    maintenance.start();
    await vi.advanceTimersByTimeAsync(25);
    await maintenance.shutdown();
    await maintenance.shutdown();

    expect(recoverEligibleTranscriptions).toHaveBeenCalledTimes(2);
    expect(listTerminalMeetingIds).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
