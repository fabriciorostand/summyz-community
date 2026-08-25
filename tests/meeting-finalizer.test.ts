import { describe, expect, it, vi } from "vitest";

import { MeetingFinalizer } from "../src/processing/meeting-finalizer.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

const manifest = markManifestCompleted(
  createManifest({
    guildId: "guild-1",
    meetingId: "meeting-1",
    notificationChannelId: "text-1",
    persistMeetingContent: true,
    startedAt: "2026-08-24T10:00:00.000Z",
    voiceChannelId: "voice-1",
  }),
  "2026-08-24T10:10:00.000Z",
);

describe("MeetingFinalizer", () => {
  it("persiste o conteúdo antes de permitir a exclusão do workspace", async () => {
    const operations: string[] = [];
    const contentStore = {
      persist: vi.fn(async () => {
        operations.push("persist");
        return true;
      }),
    };
    const transcriptionStore = {
      readRawTranscript: vi.fn(async () => "transcrição bruta"),
      readTranscript: vi.fn(async () => "transcrição refinada"),
    };
    const summaryStore = {
      load: vi.fn(async () => ({ meetingId: "meeting-1", status: "completed" })),
    };
    const publicationStore = {
      load: vi.fn(async () => ({ meetingId: "meeting-1", threadId: "thread-1" })),
    };
    const retention = {
      deleteWorkspace: vi.fn(async () => {
        operations.push("delete");
      }),
    };
    const manifestStore = { tryLoad: vi.fn(async () => manifest) };
    const finalizer = new MeetingFinalizer({
      contentStore,
      manifestStore,
      publicationStore,
      retention,
      summaryStore,
      transcriptionStore,
    });

    await finalizer.persist(manifest);
    await finalizer.cleanup(manifest.meetingId);

    expect(contentStore.persist).toHaveBeenCalledWith({
      manifest,
      meetingId: "meeting-1",
      publication: { meetingId: "meeting-1", threadId: "thread-1" },
      rawTranscript: "transcrição bruta",
      summary: { meetingId: "meeting-1", status: "completed" },
      transcript: "transcrição refinada",
    });
    expect(operations).toEqual(["persist", "delete"]);
  });

  it("não lê nem persiste conteúdo quando a persistência está desabilitada", async () => {
    const contentStore = { persist: vi.fn() };
    const transcriptionStore = {
      readRawTranscript: vi.fn(),
      readTranscript: vi.fn(),
    };
    const summaryStore = { load: vi.fn() };
    const publicationStore = { load: vi.fn() };
    const retention = { deleteWorkspace: vi.fn(async () => undefined) };
    const privateManifest = { ...manifest, persistMeetingContent: false };
    const manifestStore = { tryLoad: vi.fn(async () => privateManifest) };
    const finalizer = new MeetingFinalizer({
      contentStore,
      manifestStore,
      publicationStore,
      retention,
      summaryStore,
      transcriptionStore,
    });

    await finalizer.persist(privateManifest);
    await finalizer.cleanup(manifest.meetingId);

    expect(transcriptionStore.readRawTranscript).not.toHaveBeenCalled();
    expect(transcriptionStore.readTranscript).not.toHaveBeenCalled();
    expect(summaryStore.load).not.toHaveBeenCalled();
    expect(publicationStore.load).not.toHaveBeenCalled();
    expect(contentStore.persist).not.toHaveBeenCalled();
    expect(retention.deleteWorkspace).toHaveBeenCalledWith(privateManifest);
  });

  it("considera concluída uma limpeza cujo workspace já não existe", async () => {
    const retention = { deleteWorkspace: vi.fn() };
    const finalizer = new MeetingFinalizer({
      contentStore: { persist: vi.fn() },
      manifestStore: { tryLoad: vi.fn(async () => undefined) },
      publicationStore: { load: vi.fn() },
      retention,
      summaryStore: { load: vi.fn() },
      transcriptionStore: { readRawTranscript: vi.fn(), readTranscript: vi.fn() },
    });

    await expect(finalizer.cleanup("meeting-1")).resolves.toBeUndefined();
    expect(retention.deleteWorkspace).not.toHaveBeenCalled();
  });
});
