import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createPublicationState } from "../src/summary/publication-state.js";
import { PublicationStore } from "../src/summary/publication-store.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("PublicationStore", () => {
  it("persiste o progresso atomicamente e serializa atualizações concorrentes", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-publication-store-"));
    directories.push(root);
    const store = new PublicationStore(root);
    const initial = createPublicationState("meeting-1", "summary", "2026-08-17T10:00:00.000Z");
    const progressed = {
      ...initial,
      rootMessageId: "root-1",
      updatedAt: "2026-08-17T10:01:00.000Z",
    };

    await Promise.all([store.save(initial), store.save(progressed)]);

    await expect(store.load("meeting-1")).resolves.toEqual(progressed);
  });

  it("distingue ausência de arquivo de conteúdo persistido inválido", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-publication-store-"));
    directories.push(root);
    const store = new PublicationStore(root);

    await expect(store.tryLoad("meeting-1")).resolves.toBeUndefined();
    await mkdir(join(root, "meeting-1"));
    await writeFile(join(root, "meeting-1", "publication.json"), "inválido", "utf8");
    await expect(store.tryLoad("meeting-1")).rejects.toThrow();
    expect(() => store.path("../escape")).toThrow(/identificador/i);
  });
});
