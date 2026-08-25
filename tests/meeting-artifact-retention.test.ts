import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";
import { MeetingArtifactRetention } from "../src/processing/meeting-artifact-retention.js";
import { addSegment, createManifest, markManifestCompleted } from "../src/recording/manifest.js";
import { TranscriptionStore } from "../src/transcription/transcription-store.js";

describe("MeetingArtifactRetention", () => {
  it("exclui o áudio após a transcrição sem remover a transcrição", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const manifest = markManifestCompleted(
      addSegment(
        createManifest({
          guildId: "guild-1",
          meetingId: "meeting-1",
          notificationChannelId: "text-1",
          startedAt: "2026-08-24T10:00:00.000Z",
          voiceChannelId: "voice-1",
        }),
        {
          durationMs: 1_000,
          endedAtMs: 1_000,
          file: "participants/user-1/segment-1.ogg",
          segmentId: "segment-1",
          startedAtMs: 0,
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ),
      "2026-08-24T10:01:00.000Z",
    );
    const audioPath = store.resolveMeetingFile(
      manifest.meetingId,
      manifest.segments[0]?.file ?? "",
    );
    await mkdir(join(store.meetingDirectory(manifest.meetingId), "participants", "user-1"), {
      recursive: true,
    });
    await writeFile(audioPath, "áudio");
    await store.writeTranscript(manifest.meetingId, "transcrição\n");
    const retention = new MeetingArtifactRetention(store, createLogger("silent"));

    await retention.deleteAudio(manifest);

    await expect(access(audioPath)).rejects.toThrow();
    await expect(access(store.transcriptPath(manifest.meetingId))).resolves.toBeUndefined();
  });

  it("remove todo o workspace somente depois do resultado final", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    await store.writeTranscript("meeting-1", "transcrição\n");
    const retention = new MeetingArtifactRetention(store, createLogger("silent"));

    await retention.deleteWorkspace(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        startedAt: "2026-08-24T10:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
    );

    await expect(access(store.meetingDirectory("meeting-1"))).rejects.toThrow();
  });

  it("preserva áudio quando a opção está habilitada", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const manifest = markManifestCompleted(
      addSegment(
        createManifest({
          guildId: "guild-1",
          meetingId: "meeting-1",
          notificationChannelId: "text-1",
          persistMeetingAudio: true,
          startedAt: "2026-08-24T10:00:00.000Z",
          voiceChannelId: "voice-1",
        }),
        {
          durationMs: 1_000,
          endedAtMs: 1_000,
          file: "participants/user-1/segment-1.ogg",
          segmentId: "segment-1",
          startedAtMs: 0,
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ),
      "2026-08-24T10:01:00.000Z",
    );
    const audioPath = store.resolveMeetingFile("meeting-1", manifest.segments[0]?.file ?? "");
    await mkdir(join(store.meetingDirectory("meeting-1"), "participants", "user-1"), {
      recursive: true,
    });
    await writeFile(audioPath, "áudio");
    const retention = new MeetingArtifactRetention(store, createLogger("silent"));

    await retention.deleteAudio(manifest);

    await expect(access(audioPath)).resolves.toBeUndefined();
  });

  it("mantém somente o áudio no disco quando o catálogo está no PostgreSQL", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const directory = store.meetingDirectory("meeting-1");
    await mkdir(join(directory, "participants"), { recursive: true });
    await writeFile(join(directory, "participants", "segment.ogg"), "áudio");
    await writeFile(join(directory, "audio-manifest.json"), "{}\n");
    await store.writeTranscript("meeting-1", "transcrição\n");
    const retention = new MeetingArtifactRetention(store, createLogger("silent"));
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      storageMode: "postgres",
      voiceChannelId: "voice-1",
    });

    await retention.deleteWorkspace(manifest);

    await expect(access(join(directory, "participants", "segment.ogg"))).resolves.toBeUndefined();
    await expect(access(join(directory, "audio-manifest.json"))).rejects.toThrow();
    await expect(access(store.transcriptPath("meeting-1"))).rejects.toThrow();
  });

  it("mantém áudio e catálogo no backend local quando conteúdo está desabilitado", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const directory = store.meetingDirectory("meeting-1");
    await mkdir(join(directory, "participants"), { recursive: true });
    await writeFile(join(directory, "participants", "segment.ogg"), "áudio");
    await writeFile(join(directory, "audio-manifest.json"), "{}\n");
    await store.writeTranscript("meeting-1", "transcrição\n");
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      storageMode: "local",
      voiceChannelId: "voice-1",
    });

    await new MeetingArtifactRetention(store, createLogger("silent")).deleteWorkspace(manifest);

    await expect(access(join(directory, "participants", "segment.ogg"))).resolves.toBeUndefined();
    await expect(access(join(directory, "audio-manifest.json"))).resolves.toBeUndefined();
    await expect(access(store.transcriptPath("meeting-1"))).rejects.toThrow();
  });

  it("mantém conteúdo local e remove áudio quando somente conteúdo está habilitado", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const directory = store.meetingDirectory("meeting-1");
    await mkdir(join(directory, "participants"), { recursive: true });
    await writeFile(join(directory, "participants", "segment.ogg"), "áudio");
    await store.writeTranscript("meeting-1", "transcrição\n");
    const retention = new MeetingArtifactRetention(store, createLogger("silent"));
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingContent: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      storageMode: "local",
      voiceChannelId: "voice-1",
    });

    await retention.deleteWorkspace(manifest);

    await expect(access(join(directory, "participants"))).rejects.toThrow();
    await expect(access(store.transcriptPath("meeting-1"))).resolves.toBeUndefined();
  });

  it("preserva todo o workspace quando conteúdo local e áudio estão habilitados", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    await store.writeTranscript("meeting-1", "transcrição\n");
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      persistMeetingContent: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      storageMode: "local",
      voiceChannelId: "voice-1",
    });

    await new MeetingArtifactRetention(store, createLogger("silent")).deleteWorkspace(manifest);

    await expect(access(store.transcriptPath("meeting-1"))).resolves.toBeUndefined();
  });

  it("trata como idempotente a limpeza parcial de um diretório inexistente", async () => {
    const root = await mkdtemp(join(tmpdir(), "summyz-artifact-retention-"));
    const store = new TranscriptionStore(root);
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      startedAt: "2026-08-24T10:00:00.000Z",
      storageMode: "postgres",
      voiceChannelId: "voice-1",
    });

    await expect(
      new MeetingArtifactRetention(store, createLogger("silent")).deleteWorkspace(manifest),
    ).resolves.toBeUndefined();
  });
});
