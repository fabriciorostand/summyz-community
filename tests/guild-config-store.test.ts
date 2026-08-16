import { mkdtemp, readFile } from "node:fs/promises";
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
});
