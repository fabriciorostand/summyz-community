import { describe, expect, it, vi } from "vitest";
import type { PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresGuildHistoryStore } from "../src/database/postgres-guild-history-store.js";

function createDatabase(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _values?: readonly unknown[]) => ({
    rowCount: rows.length,
    rows,
  }));
  return { database: { query } satisfies PostgresExecutor, query };
}

describe("PostgresGuildHistoryStore", () => {
  it("remembers a guild name and lists only guilds with recorded meetings", async () => {
    const { database, query } = createDatabase([
      { guild_id: "guild-1", guild_name: "Equipe", has_meetings: true, icon_url: null },
    ]);
    const store = new PostgresGuildHistoryStore(database);

    await store.remember("guild-1", "Equipe", null);
    await expect(store.list()).resolves.toEqual([{ id: "guild-1", name: "Equipe", iconUrl: null }]);
    await expect(store.hasMeetings("guild-1")).resolves.toBe(true);
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (guild_id) DO UPDATE");
    expect(query.mock.calls[1]?.[0]).toContain("EXISTS (SELECT 1 FROM meetings");
    expect(query.mock.calls[2]?.[1]).toEqual(["guild-1"]);
  });

  it("ends only nonterminal meetings and their jobs when the bot leaves", async () => {
    const { database, query } = createDatabase([{ meeting_id: "meeting-1" }]);
    const store = new PostgresGuildHistoryStore(database);

    await expect(store.cancelPending("guild-1")).resolves.toEqual(["meeting-1"]);
    const sql = query.mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("pipeline_status NOT IN ('completed', 'failed')");
    expect(sql).toContain("failure_code = 'bot_left_guild'");
    expect(sql).toContain("UPDATE processing_jobs");
    expect(sql).not.toContain("DELETE FROM meetings");
  });
});
