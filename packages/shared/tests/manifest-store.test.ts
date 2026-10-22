import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

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
    await expect(store.listCompleted()).resolves.toEqual([completed]);
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
    await expect(store.listCompleted()).resolves.toEqual([]);
    await expect(store.tryLoad("missing")).resolves.toBeUndefined();
    await expect(store.migrateLegacyManifests()).resolves.toBe(0);
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

  it("serializa gravações concorrentes e permite aguardar a fila ao carregar", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const store = new ManifestStore(root);
    const first = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const second = markManifestCompleted(first, "2026-08-16T20:10:00.000Z");

    const firstSave = store.save(first);
    const secondSave = store.save(second);
    const loaded = store.load("meeting-1");

    await Promise.all([firstSave, secondSave]);
    await expect(loaded).resolves.toEqual(second);
  });

  it("propaga manifesto inválido encontrado durante a listagem", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    await mkdir(join(root, "meeting-invalid"));
    await writeFile(join(root, "meeting-invalid", "manifest.json"), "inválido", "utf8");
    const store = new ManifestStore(root);

    await expect(store.listRecoverable()).rejects.toBeInstanceOf(SyntaxError);
  });

  it("rejeita um manifesto cujo ID não corresponde ao diretório lido", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-other",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    await mkdir(join(root, "meeting-1"));
    await writeFile(join(root, "meeting-1", "manifest.json"), JSON.stringify(manifest), "utf8");

    await expect(new ManifestStore(root).load("meeting-1")).rejects.toThrow(/corresponde/i);
  });

  it("usa o disco para descoberta e o grava antes do índice externo", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "indexed",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const index = {
      save: vi.fn(async () => {
        await expect(readFile(join(root, "indexed", "manifest.json"), "utf8")).resolves.toContain(
          "indexed",
        );
      }),
    };
    const store = new ManifestStore(root, index);

    await store.save(manifest);
    await expect(store.listRecoverable()).resolves.toEqual([manifest]);

    expect(index.save).toHaveBeenCalledWith(manifest);
    expect(await readFile(join(root, "indexed", "manifest.json"), "utf8")).toContain("indexed");
  });

  it("migra arquivos v2 antes da recuperação sem reindexar a reunião", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const current = createManifest({
      guildId: "guild-1",
      meetingId: "legacy",
      notificationChannelId: "text-1",
      startedAt: "2026-08-24T10:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const index = { save: vi.fn(async () => undefined) };
    await mkdir(join(root, "legacy"));
    const preservedArtifactPath = join(root, "legacy", "segment.ogg");
    await writeFile(preservedArtifactPath, "audio-sentinel", "utf8");
    await writeFile(
      join(root, "legacy", "manifest.json"),
      JSON.stringify({ ...current, participants: undefined, schemaVersion: 2 }),
      "utf8",
    );
    const store = new ManifestStore(root, index);

    await expect(store.migrateLegacyManifests()).resolves.toBe(1);
    await expect(store.migrateLegacyManifests()).resolves.toBe(0);
    await expect(store.load("legacy")).resolves.toMatchObject({ schemaVersion: 3 });
    await expect(readFile(preservedArtifactPath, "utf8")).resolves.toBe("audio-sentinel");
    expect(index.save).not.toHaveBeenCalled();
  });

  it("migra arquivos v1 locais com a configuração de IA histórica", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-manifests-"));
    const legacy = {
      aiConfiguration: {
        refinement: {
          generation: {},
          maxChunkCharacters: 500_000,
          model: "qwen3:1.7b",
          prompt: null,
          provider: "ollama",
          requestedModel: "qwen3:1.7b",
          status: "selected",
        },
        selectorVersion: 3,
        summary: {
          consolidationPrompt: null,
          extractionPrompt: null,
          generation: {},
          language: "pt-BR",
          maxChunkCharacters: 500_000,
          model: "qwen3:4b",
          provider: "ollama",
          requestedModel: "qwen3:4b",
          status: "selected",
        },
        transcription: {
          batchSize: "auto",
          interSpeechSilenceMs: 0,
          language: "pt-BR",
          model: "medium",
          prompt: null,
          provider: "faster-whisper",
          requestedModel: "medium",
          status: "selected",
          timestampMode: "batch",
        },
      },
      guildId: "guild-1",
      interruptions: [],
      meetingId: "legacy-v1",
      notificationChannelId: "text-1",
      persistMeetingAudio: false,
      persistMeetingContent: true,
      schemaVersion: 1,
      segments: [
        {
          durationMs: 1_000,
          endedAtMs: 2_000,
          file: "participants/user-1/segment-1.ogg",
          format: "ogg_opus",
          segmentId: "segment-1",
          startedAtMs: 1_000,
          status: "ready",
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ],
      startedAt: "2026-08-24T10:00:00.000Z",
      status: "completed",
      storageMode: "local",
      voiceChannelId: "voice-1",
    };
    await mkdir(join(root, "legacy-v1"));
    await writeFile(join(root, "legacy-v1", "manifest.json"), JSON.stringify(legacy), "utf8");
    const store = new ManifestStore(root);

    await expect(store.migrateLegacyManifests()).resolves.toBe(1);
    await expect(store.load("legacy-v1")).resolves.toMatchObject({
      aiConfiguration: {
        profileType: "local",
        transcription: { batchSize: "auto", provider: "faster-whisper" },
      },
      participants: [{ displayName: "Ana", userId: "user-1" }],
      schemaVersion: 3,
      storageMode: "postgres",
    });
  });
});
