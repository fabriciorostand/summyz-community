import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("carrega os padrões seguros do MVP", () => {
    const config = loadConfig({
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_TOKEN: "token",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
      OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
    });

    expect(config).toMatchObject({
      dataDir: "./data",
      discordClientId: "client-id",
      discordToken: "token",
      failedRecordingRetentionHours: 24,
      openRouterApiKey: "openrouter-key",
      openRouterSummaryModel: "google/gemini-3.7-flash",
      openRouterTranscriptionModel: "openai/whisper-1",
      segmentMaxSeconds: 60,
      segmentSilenceMs: 1_000,
      summaryChunkMaxCharacters: 500_000,
      summaryMaxAttempts: 4,
      summaryRetryBaseMs: 1_000,
      summaryRetryMaxMs: 30_000,
      summaryTimeZone: "America/Sao_Paulo",
      summaryTimeoutMs: 120_000,
      transcriptionConcurrency: 2,
      transcriptionMergeMaxGapMs: 2_000,
      transcriptionModelProfilesFile: "./config/transcription-model-profiles.json",
      transcriptionMaxAttempts: 4,
      transcriptionRetryBaseMs: 1_000,
      transcriptionRetryMaxMs: 30_000,
      transcriptionTimeoutMs: 90_000,
      transcriptionVadMinSpeechMs: 96,
      transcriptionVadThreshold: 0.5,
      transcriptionWindowMaxSeconds: 30,
      voiceReconnectMaxMs: 300_000,
    });
  });

  it("rejeita durações de segmento inválidas", () => {
    expect(() =>
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_TOKEN: "token",
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
        OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
        SEGMENT_MAX_SECONDS: "0",
      }),
    ).toThrow(/SEGMENT_MAX_SECONDS/);
  });

  it("rejeita parâmetros inválidos do VAD e da consolidação", () => {
    const base = {
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_TOKEN: "token",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
      OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
    };

    expect(() => loadConfig({ ...base, TRANSCRIPTION_VAD_THRESHOLD: "1.1" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_VAD_MIN_SPEECH_MS: "31" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_MERGE_MAX_GAP_MS: "-1" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_WINDOW_MAX_SECONDS: "4" })).toThrow();
  });

  it("exige credenciais e modelos de transcrição e resumo", () => {
    expect(() => loadConfig({ DISCORD_CLIENT_ID: "client-id", DISCORD_TOKEN: "token" })).toThrow(
      /OPENROUTER_API_KEY|OPENROUTER_TRANSCRIPTION_MODEL|OPENROUTER_SUMMARY_MODEL/,
    );
  });

  it("preserva o escopo de registro por servidor", () => {
    expect(
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_GUILD_ID: "guild-1",
        DISCORD_TOKEN: "token",
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
        OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
      }).discordGuildId,
    ).toBe("guild-1");
  });

  it("rejeita limites e fusos inválidos do resumo", () => {
    const base = {
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_TOKEN: "token",
      OPENROUTER_API_KEY: "openrouter-key",
      OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
      OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
    };

    expect(() => loadConfig({ ...base, SUMMARY_CHUNK_MAX_CHARACTERS: "999" })).toThrow();
    expect(() => loadConfig({ ...base, SUMMARY_MAX_ATTEMPTS: "0" })).toThrow();
    expect(() => loadConfig({ ...base, SUMMARY_TIME_ZONE: "Fuso/Inexistente" })).toThrow();
  });
});
