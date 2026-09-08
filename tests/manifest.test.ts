import { describe, expect, it } from "vitest";

import {
  addParticipant,
  addSegment,
  createManifest,
  markManifestCompleted,
  markManifestInterrupted,
  markManifestRecording,
  recordingManifestSchema,
  requireCurrentMeetingAiConfiguration,
  setPredominantLanguage,
} from "../src/recording/manifest.js";
import { migrateRecordingManifest } from "../src/recording/manifest-migration.js";

describe("manifesto da gravação", () => {
  it("cria um manifesto versionado em estado recording", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(manifest).toMatchObject({
      participants: [],
      schemaVersion: 3,
      storageMode: "postgres",
      persistMeetingAudio: false,
      persistMeetingContent: false,
      status: "recording",
      segments: [],
    });
    expect(() => requireCurrentMeetingAiConfiguration(manifest)).toThrow(/pinned AI profile/i);
  });

  it("captura as opções de armazenamento no início da reunião", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      persistMeetingAudio: true,
      persistMeetingContent: true,
      startedAt: "2026-08-16T20:00:00.000Z",
      storageMode: "postgres",
      voiceChannelId: "voice-1",
    });

    expect(manifest).toMatchObject({
      persistMeetingAudio: true,
      persistMeetingContent: true,
      storageMode: "postgres",
    });
  });

  it("fixa idioma, modelos e autor no início e persiste uma única tag predominante", () => {
    const manifest = createManifest({
      aiConfiguration: {
        language: "es",
        profileType: "local",
        refinement: {
          model: "qwen3:4b",
          provider: "ollama",
        },
        summary: {
          model: "qwen3:8b",
          provider: "ollama",
        },
        transcription: {
          model: "small",
          provider: "faster-whisper",
        },
        translation: {
          generation: { temperature: 0 },
          model: "qwen3:8b",
          prompt: null,
          provider: "ollama",
        },
      },
      aiProfile: { name: "Local rápido", profileId: "profile-1" },
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedByUserId: "user-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(manifest.aiConfiguration).toMatchObject({
      language: "es",
      refinement: { model: "qwen3:4b", provider: "ollama" },
      summary: { model: "qwen3:8b", provider: "ollama" },
      transcription: { model: "small", provider: "faster-whisper" },
      translation: { model: "qwen3:8b", provider: "ollama" },
    });
    expect(manifest.aiProfile).toEqual({ name: "Local rápido", profileId: "profile-1" });
    const detected = setPredominantLanguage(manifest, "pt");
    expect(detected).toMatchObject({ predominantLanguage: "pt", startedByUserId: "user-1" });
    expect(detected).not.toHaveProperty("languageEvidence");
    expect(requireCurrentMeetingAiConfiguration(manifest).profileType).toBe("local");
  });

  it("preserva o avatar Discord capturado com o participante", () => {
    const manifest = addParticipant(
      createManifest({
        guildId: "guild-1",
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
      {
        avatarUrl: "https://cdn.discordapp.com/guilds/guild-1/users/user-1/avatars/hash.png",
        displayName: "Ana",
        userId: "user-1",
      },
    );

    expect(manifest.participants[0]).toMatchObject({
      avatarUrl: expect.stringContaining("cdn.discordapp.com"),
      displayName: "Ana",
    });
  });

  it("rejeita definitivamente manifestos da versão anterior", () => {
    expect(() =>
      recordingManifestSchema.parse({
        aiConfiguration: {
          refinement: {
            generation: { seed: 0, temperature: 0, think: false },
            maxChunkCharacters: 3_000,
            model: "qwen3:1.7b",
            provider: "ollama",
            requestedModel: "qwen3:1.7b",
            status: "selected",
          },
          selectorVersion: 3,
          summary: {
            generation: { seed: 0, temperature: 0, think: false },
            language: "pt-BR",
            maxChunkCharacters: 3_000,
            model: "qwen3:4b-instruct-2507-q4_K_M",
            provider: "ollama",
            requestedModel: "qwen3:4b-instruct-2507-q4_K_M",
            status: "selected",
          },
          transcription: {
            batchSize: 2,
            language: "pt-BR",
            model: "medium",
            provider: "faster-whisper",
            requestedModel: "medium",
            status: "selected",
          },
        },
        guildId: "guild-1",
        interruptions: [],
        meetingId: "meeting-1",
        notificationChannelId: "text-1",
        schemaVersion: 1,
        segments: [],
        startedAt: "2026-08-16T20:00:00.000Z",
        status: "recording",
        storageMode: "postgres",
        voiceChannelId: "voice-1",
      }),
    ).toThrow();
  });

  it("não persiste metadados do seletor automático removido", () => {
    const manifest = createManifest({
      aiConfiguration: {
        language: "auto",
        profileType: "local",
        refinement: {
          model: "qwen3:1.7b",
          provider: "ollama",
        },
        summary: {
          model: "qwen3:4b",
          provider: "ollama",
        },
        transcription: {
          model: "tiny",
          provider: "faster-whisper",
        },
      },
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(manifest.aiConfiguration?.summary).toMatchObject({ model: "qwen3:4b" });
    expect(manifest.aiConfiguration?.summary).not.toHaveProperty("hardwareWarning");
    expect(manifest.aiConfiguration?.summary).not.toHaveProperty("requestedModel");
    expect(manifest.aiConfiguration).not.toHaveProperty("selectorVersion");
  });

  it("rejeita o backend local removido", () => {
    expect(() =>
      recordingManifestSchema.parse({
        ...createManifest({
          guildId: "guild-1",
          meetingId: "meeting-1",
          notificationChannelId: "text-1",
          startedAt: "2026-08-16T20:00:00.000Z",
          voiceChannelId: "voice-1",
        }),
        storageMode: "local",
      }),
    ).toThrow();
  });

  it("adiciona segmentos sem alterar o manifesto anterior", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const updated = addSegment(manifest, {
      durationMs: 1_500,
      endedAtMs: 2_500,
      file: "participants/user-1/segment-1.ogg",
      segmentId: "segment-1",
      startedAtMs: 1_000,
      userDisplayName: "Pessoa",
      userId: "user-1",
    });

    expect(manifest.segments).toHaveLength(0);
    expect(updated.segments).toHaveLength(1);
  });

  it("registra participantes por userId e atualiza o nome exibido", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    const first = addParticipant(manifest, { displayName: "Ana", userId: "user-1" });
    const second = addParticipant(first, { displayName: "Bia", userId: "user-2" });
    const renamed = addParticipant(second, { displayName: "Ana Maria", userId: "user-1" });

    expect(manifest.participants).toEqual([]);
    expect(renamed.participants).toEqual([
      { displayName: "Ana Maria", userId: "user-1" },
      { displayName: "Bia", userId: "user-2" },
    ]);
  });

  it("migra v2 uma única vez e mantém o parser normal restrito ao v3", () => {
    const current = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const legacy = {
      ...current,
      participants: undefined,
      schemaVersion: 2,
      segments: [
        {
          durationMs: 1_000,
          endedAtMs: 1_000,
          file: "participants/user-1/segment-1.ogg",
          format: "ogg_opus",
          segmentId: "segment-1",
          startedAtMs: 0,
          status: "ready",
          userDisplayName: "Ana",
          userId: "user-1",
        },
      ],
    };

    expect(() => recordingManifestSchema.parse(legacy)).toThrow();
    expect(migrateRecordingManifest(legacy)).toMatchObject({
      participants: [{ displayName: "Ana", userId: "user-1" }],
      schemaVersion: 3,
    });
    expect(migrateRecordingManifest(current)).toEqual(current);
  });

  it("remove opções antigas de timestamps e lote externo durante a migração", () => {
    const current = createManifest({
      aiConfiguration: {
        language: "auto",
        profileType: "external",
        refinement: { model: "review", provider: "openrouter" },
        summary: { model: "summary", provider: "openrouter" },
        transcription: {
          model: "transcription",
          provider: "openrouter",
          vad: {},
        },
      },
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const legacyConfiguration = {
      ...current.aiConfiguration,
      transcription: {
        ...current.aiConfiguration?.transcription,
        batchSize: 8,
        timestampMode: "batch",
      },
    };
    const migrated = migrateRecordingManifest({
      ...current,
      aiConfiguration: legacyConfiguration,
      participants: undefined,
      schemaVersion: 2,
    });

    expect(migrated.aiConfiguration?.transcription).not.toHaveProperty("timestampMode");
    expect(migrated.aiConfiguration?.transcription).not.toHaveProperty("batchSize");
  });

  it("infere o perfil externo ao migrar uma configuração v1", () => {
    const current = createManifest({
      aiConfiguration: {
        language: "auto",
        profileType: "external",
        refinement: { model: "review", provider: "openrouter" },
        summary: { model: "summary", provider: "openrouter" },
        transcription: {
          model: "transcription",
          provider: "openrouter",
          vad: {},
        },
      },
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const currentConfiguration = current.aiConfiguration;
    if (currentConfiguration === undefined) throw new Error("Expected an AI configuration");
    const { profileType: _profileType, ...legacyConfiguration } = currentConfiguration;

    const migrated = migrateRecordingManifest({
      ...current,
      aiConfiguration: {
        ...legacyConfiguration,
        transcription: {
          ...legacyConfiguration.transcription,
          batchSize: 8,
          timestampMode: "batch",
        },
      },
      participants: undefined,
      schemaVersion: 1,
      storageMode: "local",
    });

    expect(migrated).toMatchObject({
      aiConfiguration: { profileType: "external" },
      schemaVersion: 3,
      storageMode: "postgres",
    });
    expect(migrated.aiConfiguration?.transcription).not.toHaveProperty("batchSize");
  });

  it("preserva o lote local ao remover o modo antigo de timestamps", () => {
    const current = createManifest({
      aiConfiguration: {
        language: "auto",
        profileType: "local",
        refinement: { model: "review", provider: "ollama" },
        summary: { model: "summary", provider: "ollama" },
        transcription: {
          batchSize: 4,
          model: "medium",
          provider: "faster-whisper",
          vad: {},
        },
      },
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const migrated = migrateRecordingManifest({
      ...current,
      aiConfiguration: {
        ...current.aiConfiguration,
        transcription: { ...current.aiConfiguration?.transcription, timestampMode: "batch" },
      },
      participants: undefined,
      schemaVersion: 2,
    });

    expect(migrated.aiConfiguration?.transcription).toMatchObject({ batchSize: 4 });
    expect(migrated.aiConfiguration?.transcription).not.toHaveProperty("timestampMode");
  });

  it("preserva a interrupção e permite marcar a retomada", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const interrupted = markManifestInterrupted(
      manifest,
      "2026-08-16T20:10:00.000Z",
      "voice_disconnected",
    );
    const resumed = markManifestRecording(interrupted, "2026-08-16T20:10:05.000Z");

    expect(interrupted.status).toBe("interrupted");
    expect(resumed.status).toBe("recording");
    expect(resumed.interruptions).toHaveLength(1);
  });

  it("retoma apenas a interrupção mais recente", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const first = markManifestInterrupted(manifest, "2026-08-16T20:01:00.000Z", "first");
    const firstResume = markManifestRecording(first, "2026-08-16T20:02:00.000Z");
    const second = markManifestInterrupted(firstResume, "2026-08-16T20:03:00.000Z", "second");
    const resumed = markManifestRecording(second, "2026-08-16T20:04:00.000Z");

    expect(resumed.interruptions).toEqual([
      {
        at: "2026-08-16T20:01:00.000Z",
        reason: "first",
        resumedAt: "2026-08-16T20:02:00.000Z",
      },
      {
        at: "2026-08-16T20:03:00.000Z",
        reason: "second",
        resumedAt: "2026-08-16T20:04:00.000Z",
      },
    ]);
  });

  it("marca a reunião como concluída", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });

    expect(markManifestCompleted(manifest, "2026-08-16T20:05:00.000Z")).toMatchObject({
      completedAt: "2026-08-16T20:05:00.000Z",
      status: "completed",
    });
  });

  it("rejeita caminhos absolutos e caminhos que escapam da reunião", () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const segment = {
      durationMs: 1,
      endedAtMs: 1,
      segmentId: "segment-1",
      startedAtMs: 0,
      userDisplayName: "Pessoa",
      userId: "user-1",
    };

    expect(() => addSegment(manifest, { ...segment, file: "../outside.ogg" })).toThrow(/caminho/i);
    expect(() => addSegment(manifest, { ...segment, file: "C:\\outside.ogg" })).toThrow(/caminho/i);
    expect(() =>
      recordingManifestSchema.parse({
        ...manifest,
        segments: [{ ...segment, file: "../outside.ogg" }],
      }),
    ).toThrow(/caminho/i);
  });

  it("rejeita identificadores usados na montagem de caminhos", () => {
    expect(() =>
      createManifest({
        guildId: "guild-1",
        meetingId: "../outside",
        notificationChannelId: "text-1",
        startedAt: "2026-08-16T20:00:00.000Z",
        voiceChannelId: "voice-1",
      }),
    ).toThrow();
  });
});
