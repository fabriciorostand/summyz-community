import { describe, expect, it, vi } from "vitest";

import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresGuildConfigStore } from "../src/database/postgres-guild-config-store.js";

function createDatabase(rows: Record<string, unknown>[] = []): PostgresExecutor {
  return { query: vi.fn(async () => ({ rowCount: rows.length, rows })) };
}

describe("PostgresGuildConfigStore", () => {
  it("lê funções de gravação e fórum validando os dados do banco", async () => {
    const rolesDatabase = createDatabase([{ recording_role_ids: ["role-1", "role-2"] }]);
    const forumDatabase = createDatabase([
      { summary_forum: { forumId: "forum-1", tagId: "tag-1" } },
    ]);

    await expect(
      new PostgresGuildConfigStore(rolesDatabase).listRecordingRoles("guild-1"),
    ).resolves.toEqual(["role-1", "role-2"]);
    await expect(
      new PostgresGuildConfigStore(forumDatabase).getSummaryForum("guild-1"),
    ).resolves.toEqual({ forumId: "forum-1", tagId: "tag-1" });
  });

  it("altera funções e fórum com operações atômicas no PostgreSQL", async () => {
    const database = createDatabase();
    const store = new PostgresGuildConfigStore(database);

    await store.addRecordingRole("guild-1", "role-1");
    await store.removeRecordingRole("guild-1", "role-1");
    await store.setSummaryForum("guild-1", { forumId: "forum-1" });
    await store.clearSummaryForum("guild-1");

    expect(database.query).toHaveBeenCalledTimes(4);
    expect(database.query).toHaveBeenNthCalledWith(3, expect.stringContaining("summary_forum"), [
      "guild-1",
      JSON.stringify({ forumId: "forum-1" }),
    ]);
  });

  it("rejeita configuração inválida vinda do banco", async () => {
    const database = createDatabase([{ recording_role_ids: [1] }]);
    await expect(
      new PostgresGuildConfigStore(database).listRecordingRoles("guild-1"),
    ).rejects.toThrow();
  });

  it("retorna configuração vazia quando o servidor ainda não foi configurado", async () => {
    const absent = new PostgresGuildConfigStore(createDatabase());
    const nullForum = new PostgresGuildConfigStore(createDatabase([{ summary_forum: null }]));

    await expect(absent.listRecordingRoles("guild-1")).resolves.toEqual([]);
    await expect(absent.getSummaryForum("guild-1")).resolves.toBeUndefined();
    await expect(nullForum.getSummaryForum("guild-1")).resolves.toBeUndefined();
  });
});
