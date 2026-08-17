import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSummaryState, markSummaryFailed } from "../src/summary/summary-state.js";
import { SummaryStore } from "../src/summary/summary-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("SummaryStore", () => {
  it("escreve summary.json atomicamente e recarrega o schema validado", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-summary-"));
    directories.push(root);
    const store = new SummaryStore(root);
    const state = createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z");

    await store.save(state);

    await expect(store.load("meeting-1")).resolves.toEqual(state);
    await expect(readFile(store.path("meeting-1"), "utf8")).resolves.toContain(
      '"schemaVersion": 1',
    );
    const files = await import("node:fs/promises").then(({ readdir }) =>
      readdir(store.meetingDirectory("meeting-1")),
    );
    expect(files).toEqual(["summary.json"]);
  });

  it("retorna undefined quando não existe e rejeita identificadores inseguros", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-summary-"));
    directories.push(root);
    const store = new SummaryStore(root);

    await expect(store.tryLoad("meeting-1")).resolves.toBeUndefined();
    expect(() => store.path("../escape")).toThrow(/identificador/i);
    await expect(access(join(root, "..", "escape", "summary.json"))).rejects.toThrow();
  });

  it("serializa atualizações concorrentes e propaga conteúdo persistido inválido", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-summary-"));
    directories.push(root);
    const store = new SummaryStore(root);
    const initial = createSummaryState("meeting-1", "2026-08-17T10:00:00.000Z");
    const failed = markSummaryFailed(initial, "provider_failed", 4, "2026-08-17T10:01:00.000Z");

    await Promise.all([store.save(initial), store.save(failed)]);
    await expect(store.load("meeting-1")).resolves.toEqual(failed);

    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(store.path("meeting-1"), "inválido", "utf8"),
    );
    await expect(store.tryLoad("meeting-1")).rejects.toThrow();
  });
});
