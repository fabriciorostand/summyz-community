import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GuildConfigStore } from "../src/guild-config-store.js";

describe("GuildConfigStore", () => {
  it("adiciona, lista e remove cargos por servidor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-config-"));
    const store = new GuildConfigStore(join(directory, "guilds.json"));

    await store.addRecordingRole("guild-1", "role-1");
    await store.addRecordingRole("guild-1", "role-1");
    await store.addRecordingRole("guild-1", "role-2");
    expect(await store.listRecordingRoles("guild-1")).toEqual(["role-1", "role-2"]);

    await store.removeRecordingRole("guild-1", "role-1");
    expect(await store.listRecordingRoles("guild-1")).toEqual(["role-2"]);

    const persisted = JSON.parse(await readFile(join(directory, "guilds.json"), "utf8"));
    expect(persisted.guilds["guild-1"].recordingRoleIds).toEqual(["role-2"]);
  });

  it("configura, consulta e limpa o fórum de resumos por servidor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-config-"));
    const store = new GuildConfigStore(join(directory, "guilds.json"));

    await expect(store.getSummaryForum("guild-1")).resolves.toBeUndefined();
    await store.setSummaryForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
    await store.setSummaryForum("guild-2", { forumId: "forum-2" });

    await expect(store.getSummaryForum("guild-1")).resolves.toEqual({
      forumId: "forum-1",
      tagId: "tag-1",
    });
    await expect(store.getSummaryForum("guild-2")).resolves.toEqual({ forumId: "forum-2" });

    await store.clearSummaryForum("guild-1");
    await expect(store.getSummaryForum("guild-1")).resolves.toBeUndefined();
    await expect(store.getSummaryForum("guild-2")).resolves.toEqual({ forumId: "forum-2" });
  });

  it("preserva fórum e cargos ao atualizar cada parte da configuração", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-config-"));
    const store = new GuildConfigStore(join(directory, "guilds.json"));

    await store.addRecordingRole("guild-1", "role-1");
    await store.setSummaryForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
    await store.addRecordingRole("guild-1", "role-2");
    await store.removeRecordingRole("guild-1", "role-1");

    await expect(store.listRecordingRoles("guild-1")).resolves.toEqual(["role-2"]);
    await expect(store.getSummaryForum("guild-1")).resolves.toEqual({
      forumId: "forum-1",
      tagId: "tag-1",
    });
  });

  it("mantém configuração vazia ao remover dados inexistentes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-config-"));
    const store = new GuildConfigStore(join(directory, "guilds.json"));

    await store.removeRecordingRole("guild-1", "role-1");
    await store.clearSummaryForum("guild-2");

    await expect(store.listRecordingRoles("guild-1")).resolves.toEqual([]);
    await expect(store.getSummaryForum("guild-2")).resolves.toBeUndefined();
  });

  it("propaga configuração persistida inválida", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-config-"));
    const filePath = join(directory, "guilds.json");
    await writeFile(filePath, "conteúdo inválido", "utf8");
    const store = new GuildConfigStore(filePath);

    await expect(store.listRecordingRoles("guild-1")).rejects.toBeInstanceOf(SyntaxError);
  });
});
