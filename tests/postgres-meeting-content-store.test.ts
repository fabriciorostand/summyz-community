import { describe, expect, it, vi } from "vitest";

import { PostgresMeetingContentStore } from "../src/database/postgres-meeting-content-store.js";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";

function createDatabase() {
  const query = vi.fn(async (_text: string, _values?: readonly unknown[]) => ({
    rowCount: 1,
    rows: [],
  }));
  return { database: { query } satisfies PostgresExecutor, query };
}

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
  summary: { status: "completed", summary: { executiveSummary: "Resumo" } },
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
    ]);
    const publicationJson = query.mock.calls[0]?.[1]?.[4];
    expect(typeof publicationJson === "string" ? JSON.parse(publicationJson) : undefined).toEqual(
      content.publication,
    );
  });
});
