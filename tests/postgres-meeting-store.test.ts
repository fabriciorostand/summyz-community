import { describe, expect, it, vi } from "vitest";

import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";

const activeManifest = createManifest({
  guildId: "guild-1",
  meetingId: "meeting-1",
  notificationChannelId: "text-1",
  startedAt: "2026-08-24T10:00:00.000Z",
  voiceChannelId: "voice-1",
  voiceChannelName: "Planejamento",
});

function createDatabase(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
    rowCount: rows.length,
    rows,
  }));
  return { database: { query } satisfies PostgresExecutor, query };
}

describe("PostgresMeetingStore", () => {
  it("persiste as políticas fixadas e promove uma reunião concluída para a fila", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingStore(database);
    const completed = markManifestCompleted(
      {
        ...activeManifest,
        persistMeetingAudio: true,
        persistMeetingContent: true,
        storageMode: "postgres",
      },
      "2026-08-24T10:10:00.000Z",
    );

    await store.save(completed);

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO meetings[\s\S]+INSERT INTO processing_jobs/),
      [
        completed.meetingId,
        completed.guildId,
        completed.voiceChannelId,
        completed.notificationChannelId,
        completed.status,
        "queued",
        JSON.stringify(completed),
        true,
        true,
        "postgres",
        completed.startedAt,
        completed.completedAt,
        expect.any(String),
        expect.any(String),
      ],
    );
  });

  it("lista manifestos válidos pelo estado de gravação", async () => {
    const completed = markManifestCompleted(activeManifest, "2026-08-24T10:10:00.000Z");
    const { database, query } = createDatabase([{ manifest: completed }]);
    const store = new PostgresMeetingStore(database);

    await expect(store.listCompleted()).resolves.toEqual([completed]);

    expect(query.mock.calls[0]?.[1]).toEqual(["completed"]);
  });

  it("persiste gravação ativa e lista manifestos recuperáveis", async () => {
    const { database, query } = createDatabase([{ manifest: activeManifest }]);
    const store = new PostgresMeetingStore(database);
    const postgresManifest = { ...activeManifest, storageMode: "postgres" as const };

    await store.save(postgresManifest);
    await expect(store.listRecoverable()).resolves.toEqual([activeManifest]);

    expect(query.mock.calls[0]?.[1]).toEqual([
      postgresManifest.meetingId,
      postgresManifest.guildId,
      postgresManifest.voiceChannelId,
      postgresManifest.notificationChannelId,
      "recording",
      "recording",
      JSON.stringify(postgresManifest),
      false,
      false,
      "postgres",
      postgresManifest.startedAt,
      null,
      expect.any(String),
      expect.any(String),
    ]);
    expect(query.mock.calls[1]?.[0]).toContain("recording_status <>");
  });

  it("carrega uma reunião e informa quando ela não existe", async () => {
    const existing = createDatabase([{ manifest: activeManifest }]);
    await expect(new PostgresMeetingStore(existing.database).load("meeting-1")).resolves.toEqual(
      activeManifest,
    );

    const missing = createDatabase();
    await expect(new PostgresMeetingStore(missing.database).load("meeting-1")).rejects.toThrow(
      /não existe/i,
    );
  });

  it("lista reuniões terminais para reconciliar a limpeza local", async () => {
    const { database, query } = createDatabase([{ meeting_id: "meeting-1" }]);
    const store = new PostgresMeetingStore(database);
    await expect(store.listTerminalMeetingIds()).resolves.toEqual(["meeting-1"]);
    await store.markArtifactsDeleted("meeting-1");

    expect(query.mock.calls[0]?.[0]).toContain("artifacts_deleted_at IS NULL");
    expect(query.mock.calls[1]?.[1]).toEqual(["meeting-1"]);
  });

  it("atualiza o estágio e um código seguro de falha", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingStore(database);

    await store.updatePipeline("meeting-1", "transcribing");
    await store.updatePipeline("meeting-1", "failed", "provider_failed");

    expect(query.mock.calls[1]?.[0]).toContain("manifest = CASE");
    expect(query.mock.calls[0]?.[1]).toEqual(["meeting-1", "transcribing", null]);
    expect(query.mock.calls[1]?.[1]).toEqual(["meeting-1", "failed", "provider_failed"]);
  });

  it("ignora manifestos de reuniões iniciadas no modo local", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingStore(database);

    await store.save(activeManifest);

    expect(query).not.toHaveBeenCalled();
  });
});
