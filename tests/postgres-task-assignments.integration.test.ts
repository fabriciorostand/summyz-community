import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../src/database/postgres-database.js";
import { PostgresMeetingContentStore } from "../src/database/postgres-meeting-content-store.js";
import { PostgresMeetingStore } from "../src/database/postgres-meeting-store.js";
import { PostgresTaskStore } from "../src/database/postgres-task-store.js";
import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { createSummaryState, markSummaryCompleted } from "../src/summary/summary-state.js";

const connectionString = process.env.POSTGRES_TEST_URL;

describe.skipIf(connectionString === undefined)("tarefas compartilhadas no PostgreSQL real", () => {
  it("mantém cada tarefa única, os responsáveis e a conclusão após persistência e leitura", async () => {
    const admin = new Pool({ connectionString });
    const schema = `task_contract_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(connectionString ?? "postgresql://invalid");
    url.searchParams.set("options", `-c search_path=${schema}`);
    const database = createPostgresDatabase(url.toString());
    try {
      await database.initialize();
      const meetingId = randomUUID();
      const manifest = markManifestCompleted(
        createManifest({
          meetingId,
          guildId: "guild-contract",
          notificationChannelId: "text-contract",
          voiceChannelId: "voice-contract",
          startedAt: "2026-10-18T17:00:00.000Z",
          persistMeetingContent: true,
        }),
        "2026-10-18T17:01:00.000Z",
      );
      await new PostgresMeetingStore(database).save(manifest);
      const summary = markSummaryCompleted(
        createSummaryState(meetingId, "2026-10-18T17:01:00.000Z"),
        {
          decisions: [],
          discussedTopics: [],
          executiveSummary: "Planejamento",
          observations: [],
          tasks: [
            {
              text: "Revisar juntos",
              ownerNames: ["Bruno", "Carla"],
              deadlineText: "amanhã",
              deadlineDate: "2026-10-19",
              deadlinePrecision: "date",
              deadlineTimeZone: "America/Sao_Paulo",
            },
            { text: "Consultar fornecedor", ownerNames: ["Pessoa externa"] },
            { text: "Investigar", ownerNames: [] },
            { text: "Legada", ownerName: "Ana" },
          ],
        },
        1,
        "2026-10-18T17:02:00.000Z",
        { attempts: 1, status: "confirmed", detectedLanguage: "pt", requestedLanguage: "pt-BR" },
      );
      const input = {
        meetingId,
        manifest,
        summary,
        rawTranscript: "transcrição bruta",
        transcript: "transcrição revisada",
        publication: {
          schemaVersion: 1 as const,
          meetingId,
          status: "completed" as const,
          mode: "summary" as const,
          createdAt: "2026-10-18T17:01:00.000Z",
          updatedAt: "2026-10-18T17:02:00.000Z",
          completedAt: "2026-10-18T17:02:00.000Z",
          threadId: "thread-contract",
          rootMessageId: "root-contract",
          summaryMessageIds: ["summary-contract"],
          transcriptMessageId: "transcript-contract",
        },
      };
      const content = new PostgresMeetingContentStore(database);
      await content.persist(input);
      const tasks = new PostgresTaskStore(database);
      const before = await tasks.list("guild-contract");
      expect(before).toHaveLength(4);
      expect(before.find((task) => task.text === "Revisar juntos")).toMatchObject({
        ownerNames: ["Bruno", "Carla"],
        ownerUserId: null,
        deadlineDate: "2026-10-19",
      });
      expect(before.find((task) => task.text === "Consultar fornecedor")).toMatchObject({
        ownerNames: ["Pessoa externa"],
        ownerName: "Pessoa externa",
      });
      expect(before.find((task) => task.text === "Investigar")).toMatchObject({
        ownerNames: [],
        ownerName: null,
      });
      expect(before.find((task) => task.text === "Legada")).not.toHaveProperty("ownerNames");
      const shared = before.find((task) => task.text === "Revisar juntos");
      if (shared === undefined) throw new Error("Expected the shared task");
      await tasks.setCompleted("guild-contract", shared.taskId, null, true);
      await content.persist(input);
      const after = await tasks.list("guild-contract");
      expect(after).toHaveLength(4);
      expect(after.find((task) => task.taskId === shared.taskId)).toMatchObject({
        completedAt: expect.any(String),
        ownerNames: ["Bruno", "Carla"],
      });
      await tasks.setCompleted("guild-contract", shared.taskId, null, false);
      expect(await tasks.list("guild-contract", { completed: false })).toHaveLength(4);
    } finally {
      await database.close();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
