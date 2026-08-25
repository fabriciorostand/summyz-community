import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { LocalMeetingAudioCatalog } from "../src/processing/local-meeting-audio-catalog.js";
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
  it("grava um manifesto mínimo no diretório local da reunião", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-audio-catalog-"));
    const catalog = new LocalMeetingAudioCatalog(root);

    await expect(catalog.persist(manifest)).resolves.toBe(true);

    const parsed: unknown = JSON.parse(
      await readFile(join(root, "meeting-1", "audio-manifest.json"), "utf8"),
    );
    expect(parsed).toEqual({
      meetingId: "meeting-1",
      schemaVersion: 1,
      segments: [
        {
          durationMs: 1_000,
          endedAtMs: 2_000,
          format: "ogg_opus",
          relativePath: "recordings/meeting-1/participants/user-1/segment-1.ogg",
          segmentId: "segment-1",
          startedAtMs: 1_000,
          status: "ready",
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ],
    });
  });

  it("registra caminhos relativos e metadados no PostgreSQL", async () => {
    const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
      rowCount: 1,
      rows: [],
    }));
    const database = { query } satisfies PostgresExecutor;
    const catalog = new PostgresMeetingAudioCatalog(database);
    const postgresManifest = { ...manifest, storageMode: "postgres" as const };

    await expect(catalog.persist(postgresManifest)).resolves.toBe(true);

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
    const root = await mkdtemp(join(tmpdir(), "summyz-audio-catalog-"));
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));

    const disabledManifest = { ...manifest, persistMeetingAudio: false };
    await expect(new LocalMeetingAudioCatalog(root).persist(disabledManifest)).resolves.toBe(false);
    await expect(
      new PostgresMeetingAudioCatalog({ query }).persist({
        ...disabledManifest,
        storageMode: "postgres",
      }),
    ).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("não envia catálogo ao backend diferente daquele fixado no manifesto", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-audio-catalog-"));
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));

    await expect(
      new LocalMeetingAudioCatalog(root).persist({ ...manifest, storageMode: "postgres" }),
    ).resolves.toBe(false);
    await expect(new PostgresMeetingAudioCatalog({ query }).persist(manifest)).resolves.toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
