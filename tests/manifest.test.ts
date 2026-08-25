import { describe, expect, it } from "vitest";

import {
  addSegment,
  createManifest,
  markManifestCompleted,
  markManifestInterrupted,
  markManifestRecording,
  recordingManifestSchema,
} from "../src/recording/manifest.js";

describe("manifesto da gravação", () => {
  it("cria um manifesto versionado em estado recording", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      storageMode: "local",
      persistMeetingAudio: false,
      persistMeetingContent: false,
      status: "recording",
      segments: [],
    });
  });

  it("captura as opções de armazenamento no início da reunião", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      persistMeetingContent: true,
      startedAt: "2026-08-16T20:00:00.000Z",
      storageMode: "postgres",
      voiceChannelId: "voice-1",
    });

    expect(manifest).toMatchObject({
      persistMeetingAudio: true,
      persistMeetingContent: true,
      storageMode: "postgres",
    });
  });

  it("adiciona segmentos sem alterar o manifesto anterior", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const updated = addSegment(manifest, {
      durationMs: 1_500,
      endedAtMs: 2_500,
      file: "participants/user-1/segment-1.ogg",
      segmentId: "segment-1",
      startedAtMs: 1_000,
      userDisplayName: "Pessoa",
      userId: "user-1",
    });

    expect(manifest.segments).toHaveLength(0);
    expect(updated.segments).toHaveLength(1);
  });

  it("preserva a interrupção e permite marcar a retomada", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = markManifestInterrupted(
      manifest,
      "2026-08-16T20:10:00.000Z",
      "voice_disconnected",
    );
    const resumed = markManifestRecording(interrupted, "2026-08-16T20:10:05.000Z");

    expect(interrupted.status).toBe("interrupted");
    expect(resumed.status).toBe("recording");
    expect(resumed.interruptions).toHaveLength(1);
  });

  it("retoma apenas a interrupção mais recente", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const first = markManifestInterrupted(manifest, "2026-08-16T20:01:00.000Z", "first");
    const firstResume = markManifestRecording(first, "2026-08-16T20:02:00.000Z");
    const second = markManifestInterrupted(firstResume, "2026-08-16T20:03:00.000Z", "second");
    const resumed = markManifestRecording(second, "2026-08-16T20:04:00.000Z");

    expect(resumed.interruptions).toEqual([
      {
        at: "2026-08-16T20:01:00.000Z",
        reason: "first",
        resumedAt: "2026-08-16T20:02:00.000Z",
      },
      {
        at: "2026-08-16T20:03:00.000Z",
        reason: "second",
        resumedAt: "2026-08-16T20:04:00.000Z",
      },
    ]);
  });

  it("marca a reunião como concluída", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(markManifestCompleted(manifest, "2026-08-16T20:05:00.000Z")).toMatchObject({
      completedAt: "2026-08-16T20:05:00.000Z",
      status: "completed",
    });
  });

  it("rejeita caminhos absolutos e caminhos que escapam da reunião", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const segment = {
      durationMs: 1,
      endedAtMs: 1,
      segmentId: "segment-1",
      startedAtMs: 0,
      userDisplayName: "Pessoa",
      userId: "user-1",
    };

    expect(() => addSegment(manifest, { ...segment, file: "../outside.ogg" })).toThrow(/caminho/i);
    expect(() => addSegment(manifest, { ...segment, file: "C:\\outside.ogg" })).toThrow(/caminho/i);
    expect(() =>
      recordingManifestSchema.parse({
        ...manifest,
        segments: [{ ...segment, file: "../outside.ogg" }],
      }),
    ).toThrow(/caminho/i);
  });

  it("rejeita identificadores usados na montagem de caminhos", () => {
    expect(() =>
      createManifest({
        guildId: "guild-1",
        meetingId: "../outside",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
    ).toThrow();
  });
});
