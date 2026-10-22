import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresTaskStore } from "../src/database/postgres-task-store.js";

const taskId = "2b8dfb58-2511-4b20-a535-103ec73d87d9";

describe("PostgresTaskStore", () => {
  it("lists immutable tasks with normalized deadlines and overdue state", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({
      rowCount: 1,
      rows: [
        {
          completed_at: null,
          completed_by_user_id: null,
          deadline_date: "2026-08-25",
          deadline_precision: "minute",
          deadline_text: "amanhã às 20:30",
          deadline_time: "20:30",
          deadline_time_zone: "America/Sao_Paulo",
          meeting_id: "meeting-1",
          owner_avatar_url: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
          owner_display_name: "Ana Atualizada",
          overdue: true,
          owner_name: "Ana",
          owner_user_id: "user-1",
          task_id: taskId,
          task_text: "Enviar o relatório.",
          voice_channel_name: "Launch Week Sync",
        },
      ],
    }));
    const store = new PostgresTaskStore({ query });

    await expect(store.list("guild-1", { completed: false })).resolves.toEqual([
      {
        completedAt: null,
        completedByUserId: null,
        deadlineDate: "2026-08-25",
        deadlinePrecision: "minute",
        deadlineText: "amanhã às 20:30",
        deadlineTime: "20:30",
        deadlineTimeZone: "America/Sao_Paulo",
        meetingId: "meeting-1",
        ownerAvatarUrl: "https://cdn.discordapp.com/avatars/user-1/avatar.png",
        ownerDisplayName: "Ana Atualizada",
        overdue: true,
        ownerName: "Ana",
        ownerUserId: "user-1",
        taskId,
        text: "Enviar o relatório.",
        voiceChannelName: "Launch Week Sync",
      },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain("AT TIME ZONE");
    expect(query.mock.calls[0]?.[0]).toContain("JOIN meetings");
    expect(query.mock.calls[0]?.[0]).toContain("meeting_participants");
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", false, null]);
  });

  it("marks completion without allowing task content changes", async () => {
    const query = vi.fn<PostgresExecutor["query"]>(async () => ({ rowCount: 1, rows: [] }));
    const store = new PostgresTaskStore({ query });

    await store.setCompleted("guild-1", taskId, null, true);
    await store.setCompleted("guild-1", taskId, null, false);

    expect(query.mock.calls[0]?.[0]).toContain("completed_at");
    expect(query.mock.calls[0]?.[0]).not.toContain("task_text =");
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", taskId, null, true]);
  });
});
