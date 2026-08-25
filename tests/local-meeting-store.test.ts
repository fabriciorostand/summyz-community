import { describe, expect, it, vi } from "vitest";

import { LocalMeetingStore } from "../src/processing/local-meeting-store.js";
import { createManifest } from "../src/recording/manifest.js";

const manifest = createManifest({
  guildId: "guild-1",
  meetingId: "meeting-1",
  notificationChannelId: "text-1",
  startedAt: "2026-08-24T10:00:00.000Z",
  voiceChannelId: "voice-1",
});

describe("LocalMeetingStore", () => {
  it("usa manifestos da etapa 3 e delega marcadores terminais à fila local", async () => {
    const manifestStore = { load: vi.fn(async () => manifest) };
    const processingStore = {
      listTerminalMeetingIds: vi.fn(async () => ["meeting-1"]),
      markArtifactsDeleted: vi.fn(async () => undefined),
    };
    const store = new LocalMeetingStore(manifestStore, processingStore);

    await expect(store.load("meeting-1")).resolves.toEqual(manifest);
    await expect(store.listTerminalMeetingIds()).resolves.toEqual(["meeting-1"]);
    await store.markArtifactsDeleted("meeting-1");
    await expect(store.updatePipeline("meeting-1", "transcribing")).resolves.toBeUndefined();

    expect(processingStore.markArtifactsDeleted).toHaveBeenCalledWith("meeting-1");
  });
});
