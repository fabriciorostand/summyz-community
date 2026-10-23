import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRefinementState,
  markRefinementFallback,
} from "../src/refinement/refinement-state.js";
import { RefinementStore } from "../src/refinement/refinement-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("RefinementStore", () => {
  it("escreve refinement.json atomicamente e serializa atualizações", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-refinement-"));
    directories.push(root);
    const store = new RefinementStore(root);
    const initial = createRefinementState("meeting-1", "2026-08-17T10:00:00.000Z");
    const fallback = markRefinementFallback(
      initial,
      [{ endedAtMs: 2_000, id: "a", speaker: "Ana", startedAtMs: 1_000, text: "texto" }],
      3,
      "2026-08-17T10:01:00.000Z",
    );

    await Promise.all([store.save(initial), store.save(fallback)]);

    await expect(store.load("meeting-1")).resolves.toEqual(fallback);
    await expect(readFile(store.path("meeting-1"), "utf8")).resolves.toContain(
      '"status": "fallback"',
    );
  });

  it("retorna undefined quando não existe e rejeita identificadores inseguros", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-refinement-"));
    directories.push(root);
    const store = new RefinementStore(root);

    await expect(store.tryLoad("meeting-1")).resolves.toBeUndefined();
    expect(() => store.path("../escape")).toThrow(/identificador/i);
    await expect(access(join(root, "..", "escape", "refinement.json"))).rejects.toThrow();
  });
});
