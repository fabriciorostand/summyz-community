import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresMeetingContentStore } from "../src/database/postgres-meeting-content-store.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { createSummaryState, markSummaryCompleted } from "../src/summary/summary-state.js";

function createDatabase() {
  const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
    rowCount: 1,
    rows: [],
  }));
  return { database: { query } satisfies PostgresExecutor, query };
}

const completedSummary = markSummaryCompleted(
  createSummaryState("meeting-1", "2026-08-24T10:10:00.000Z"),
  {
    decisions: [],
    discussedTopics: ["Entrega"],
    executiveSummary: "Resumo",
    observations: [],
    tasks: [
      {
        deadlineDate: "2026-08-25",
        deadlinePrecision: "minute",
        deadlineText: "amanhã às 20:30",
        deadlineTime: "20:30",
        deadlineTimeZone: "America/Sao_Paulo",
        ownerName: "Ana",
        text: "Enviar o relatório.",
      },
    ],
  },
  1,
  "2026-08-24T10:11:00.000Z",
  "pt",
);

const content = {
  manifest: markManifestCompleted(
    createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    }),
    "2026-08-24T10:10:00.000Z",
  ),
  meetingId: "meeting-1",
  publication: {
    completedAt: "2026-08-24T10:11:00.000Z",
    createdAt: "2026-08-24T10:10:00.000Z",
    meetingId: "meeting-1",
    mode: "summary" as const,
    rootMessageId: "root-1",
    schemaVersion: 1 as const,
    status: "completed" as const,
    summaryMessageIds: ["summary-1"],
    threadId: "thread-1",
    transcriptMessageId: "transcript-1",
    updatedAt: "2026-08-24T10:11:00.000Z",
  },
  rawTranscript: "texto bruto",
  summary: completedSummary,
  transcript: "texto revisado",
};

describe("PostgresMeetingContentStore", () => {
  it("persiste transcrições e resumo quando a opção está ativada", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingContentStore(database);

    await expect(store.persist(content)).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO meeting_contents"), [
      "meeting-1",
      "texto bruto",
      "texto revisado",
      JSON.stringify(content.summary),
      expect.any(String),
      JSON.stringify(content.manifest),
      expect.any(String),
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO meeting_tasks");
    expect(JSON.parse(String(query.mock.calls[0]?.[1]?.[6]))).toEqual([
      expect.objectContaining({
        deadline_date: "2026-08-25",
        deadline_precision: "minute",
        task_text: "Enviar o relatório.",
      }),
    ]);
    const publicationJson = query.mock.calls[0]?.[1]?.[4];
    expect(typeof publicationJson === "string" ? JSON.parse(publicationJson) : undefined).toEqual(
      content.publication,
    );
  });

  it("rejeita conteúdo que não pode ser representado em JSON", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingContentStore(database);

    await expect(store.persist({ ...content, summary: undefined })).rejects.toThrow(
      /não pode ser serializado/i,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("persists the Discord publication target independently from retained content", async () => {
    const { database, query } = createDatabase();
    const store = new PostgresMeetingContentStore(database);

    await store.persistPublication("meeting-1", content.publication);

    expect(query).toHaveBeenCalledWith(expect.stringContaining("publication_thread_id"), [
      "meeting-1",
      "thread-1",
      "root-1",
    ]);
  });
});
