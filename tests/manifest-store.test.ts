import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { ManifestStore } from "../src/recording/manifest-store.js";

describe("ManifestStore", () => {
  it("persiste e recarrega um manifesto", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(root);
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    await store.save(manifest);

    await expect(store.load("meeting-1")).resolves.toEqual(manifest);
    expect(JSON.parse(await readFile(join(root, "meeting-1", "manifest.json"), "utf8"))).toEqual(
      manifest,
    );
  });

  it("lista apenas reuniões que precisam de recuperação", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(root);
    const active = createManifest({
      guildId: "guild-1",
      meetingId: "active",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const completed = markManifestCompleted(
      createManifest({
        guildId: "guild-2",
        meetingId: "completed",
        notificationChannelId: "text-2",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-2",
      }),
      "2026-08-16T20:10:00.000Z",
    );

    await store.save(active);
    await store.save(completed);

    await expect(store.listRecoverable()).resolves.toEqual([active]);
  });

  it("rejeita identificadores que escapam do diretório de gravações", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(root);

    await expect(store.load("../outside")).rejects.toThrow(/identificador/i);
  });

  it("retorna uma lista vazia quando o diretório ainda não existe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(join(directory, "missing"));

    await expect(store.listRecoverable()).resolves.toEqual([]);
  });

  it("ignora arquivos e diretórios sem manifesto", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    await writeFile(join(root, "arquivo.txt"), "ignorado", "utf8");
    await mkdir(join(root, "meeting-without-manifest"));
    await mkdir(join(root, "invalid.name"));
    const store = new ManifestStore(root);

    await expect(store.listRecoverable()).resolves.toEqual([]);
  });

  it("monta caminhos seguros e prepara o diretório do participante", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(root);
    const paths = store.segmentPaths("meeting-1", "user-1", "segment-1");

    await store.prepareSegmentDirectory("meeting-1", "user-1");

    expect(paths.relativeFinalPath).toBe("participants/user-1/segment-1.ogg");
    expect(paths.relativeTemporaryPath).toBe("participants/user-1/segment-1.pcm");
    await expect(writeFile(paths.temporaryPath, "audio", { flag: "wx" })).resolves.toBeUndefined();
  });
});
