import { describe, expect, it, vi } from "vitest";

import { PostgresMeetingAudioCatalog } from "../src/database/postgres-meeting-audio-catalog.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { addSegment, createManifest, markManifestCompleted } from "../src/recording/manifest.js";

const manifest = markManifestCompleted(
  addSegment(
    createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    }),
    {
      durationMs: 1_000,
      endedAtMs: 2_000,
      file: "participants/user-1/segment-1.ogg",
      format: "ogg_opus",
      segmentId: "segment-1",
      startedAtMs: 1_000,
      status: "ready",
      userDisplayName: "Ana",
      userId: "user-1",
    },
  ),
  "2026-08-24T10:03:00.000Z",
);

describe("catálogo persistente de áudio", () => {
  it("registra caminhos relativos e metadados no PostgreSQL", async () => {
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
      rowCount: 1,
      rows: [],
    }));
    const catalog = new PostgresMeetingAudioCatalog({ query } satisfies PostgresExecutor);

    await expect(catalog.persist(manifest)).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("meeting_audio_segments"), [
      "meeting-1",
      expect.any(String),
    ]);
    const serialized = query.mock.calls[0]?.[1]?.[1];
    expect(typeof serialized === "string" ? JSON.parse(serialized) : undefined).toEqual([
      expect.objectContaining({
        relativePath: "recordings/meeting-1/participants/user-1/segment-1.ogg",
        userDisplayName: "Ana",
      }),
    ]);
  });

  it("não cria catálogo quando a persistência está desabilitada", async () => {
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    const catalog = new PostgresMeetingAudioCatalog({ query });

    await expect(catalog.persist({ ...manifest, persistMeetingAudio: false })).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
