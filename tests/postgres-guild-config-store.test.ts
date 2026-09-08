import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresGuildConfigStore } from "../src/database/postgres-guild-config-store.js";

function createDatabase(rows: Record<string, unknown>[] = []): PostgresExecutor {
  return { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };
}

describe("PostgresGuildConfigStore", () => {
  it("uses content retention on and audio retention off for a new guild", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 0,
      rows: [],
    });
    const store = new PostgresGuildConfigStore({ query });

    await expect(store.getGuildSettings("guild-1")).resolves.toEqual({
      botLanguage: "en",
      persistMeetingAudio: false,
      persistMeetingContent: true,
    });
  });

  it("persists validated per-guild language and retention", async () => {
    const query = vi.fn<PostgresExecutor["query"]>().mockResolvedValue({
      rowCount: 1,
      rows: [],
    });
    const store = new PostgresGuildConfigStore({ query });

    await store.setGuildSettings("guild-1", {
      botLanguage: "pt-BR",
      persistMeetingAudio: true,
      persistMeetingContent: false,
    });

    expect(query.mock.calls[0]?.[0]).toMatch(/persist_meeting_content/i);
    expect(query.mock.calls[0]?.[1]).toEqual(["guild-1", "pt-BR", false, true]);
  });
  it("lê permissões de gravação e fórum validando os dados do banco", async () => {
    const permissionsDatabase = createDatabase([
      {
        recording_role_ids: ["role-1", "role-2"],
        recording_user_grants: [{ memberJoinedAt: "2026-09-08T12:00:00.000Z", userId: "user-1" }],
      },
    ]);
    const forumDatabase = createDatabase([
      { summary_forum: { forumId: "forum-1", tagId: "tag-1" } },
    ]);

    await expect(
      new PostgresGuildConfigStore(permissionsDatabase).getRecordingPermissions("guild-1"),
    ).resolves.toEqual({
      roleIds: ["role-1", "role-2"],
      userGrants: [{ memberJoinedAt: "2026-09-08T12:00:00.000Z", userId: "user-1" }],
    });
    await expect(
      new PostgresGuildConfigStore(forumDatabase).getSummaryForum("guild-1"),
    ).resolves.toEqual({ forumId: "forum-1", tagId: "tag-1" });
  });

  it("altera permissões e fórum com operações atômicas no PostgreSQL", async () => {
    const database = createDatabase();
    const store = new PostgresGuildConfigStore(database);

    await store.setRecordingPermissions("guild-1", {
      roleIds: ["role-1"],
      userGrants: [{ memberJoinedAt: "2026-09-08T12:00:00.000Z", userId: "user-1" }],
    });
    await store.removeRecordingUser("guild-1", "user-1");
    await store.setSummaryForum("guild-1", { forumId: "forum-1" });
    await store.clearSummaryForum("guild-1");

    expect(database.query).toHaveBeenCalledTimes(4);
    expect(database.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("recording_user_grants"),
      [
        "guild-1",
        JSON.stringify(["role-1"]),
        JSON.stringify([{ memberJoinedAt: "2026-09-08T12:00:00.000Z", userId: "user-1" }]),
      ],
    );
    expect(database.query).toHaveBeenNthCalledWith(2, expect.stringContaining("value->>'userId'"), [
      "guild-1",
      "user-1",
    ]);
    expect(database.query).toHaveBeenNthCalledWith(3, expect.stringContaining("summary_forum"), [
      "guild-1",
      JSON.stringify({ forumId: "forum-1" }),
    ]);
  });

  it("rejeita configuração inválida vinda do banco", async () => {
    const database = createDatabase([{ recording_role_ids: [1], recording_user_grants: [] }]);
    await expect(
      new PostgresGuildConfigStore(database).getRecordingPermissions("guild-1"),
    ).rejects.toThrow();
  });

  it("retorna configuração vazia quando o servidor ainda não foi configurado", async () => {
    const absent = new PostgresGuildConfigStore(createDatabase());
    const nullForum = new PostgresGuildConfigStore(createDatabase([{ summary_forum: null }]));

    await expect(absent.getRecordingPermissions("guild-1")).resolves.toEqual({
      roleIds: [],
      userGrants: [],
    });
    await expect(absent.getSummaryForum("guild-1")).resolves.toBeUndefined();
    await expect(nullForum.getSummaryForum("guild-1")).resolves.toBeUndefined();
  });
});
