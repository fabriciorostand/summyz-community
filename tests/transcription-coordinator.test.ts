import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import {
  TranscriptionCoordinator,
  type MeetingTranscriber,
} from "../src/transcription/transcription-coordinator.js";

describe("TranscriptionCoordinator", () => {
  it("não inicia duas transcrições para a mesma reunião e aguarda no shutdown", async () => {
    let release: (() => void) | undefined;
    const process = vi.fn(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const transcriber: MeetingTranscriber = { process };
    const coordinator = new TranscriptionCoordinator(transcriber, createLogger("silent"));
    const manifest = markManifestCompleted(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      "2026-08-16T20:01:00.000Z",
    );

    expect(coordinator.start(manifest)).toBe(true);
    expect(coordinator.start(manifest)).toBe(false);
    const shutdown = coordinator.shutdown();
    await new Promise((resolve) => setImmediate(resolve));
    expect(process).toHaveBeenCalledOnce();
    let finished = false;
    void shutdown.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);

    release?.();
    await shutdown;
    expect(finished).toBe(true);
  });

  it("trata uma rejeição inesperada e libera a reunião", async () => {
    const process = vi.fn(async () => {
      throw new Error("falha inesperada");
    });
    const coordinator = new TranscriptionCoordinator({ process }, createLogger("silent"));
    const manifest = markManifestCompleted(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-error",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      "2026-08-16T20:01:00.000Z",
    );

    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();
    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();
    expect(process).toHaveBeenCalledTimes(2);
  });

  it("trata rejeição externa que não usa Error", async () => {
    const process = vi.fn(() => Promise.reject("falha externa"));
    const coordinator = new TranscriptionCoordinator({ process }, createLogger("silent"));
    const manifest = markManifestCompleted(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-external-error",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      "2026-08-16T20:01:00.000Z",
    );

    expect(coordinator.start(manifest)).toBe(true);
    await coordinator.shutdown();
  });
});
