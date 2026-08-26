import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const requiredEnvironment = {
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_TOKEN: "token",
  OPENROUTER_API_KEY: "openrouter-key",
  OPENROUTER_REFINEMENT_MODEL: "google/gemini-3.7-flash",
  OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
  OPENROUTER_TRANSCRIPTION_MODEL: "openai/whisper-1",
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("carrega os padrões seguros do MVP", () => {
    const config = loadConfig({
      ...requiredEnvironment,
    });

    expect(config).toMatchObject({
      botLanguage: "en",
      dataDir: "./data",
      discordClientId: "client-id",
      discordToken: "token",
      openRouterApiKey: "openrouter-key",
      openRouterRefinementModel: "google/gemini-3.7-flash",
      openRouterSummaryModel: "google/gemini-3.7-flash",
      openRouterTranscriptionModel: "openai/whisper-1",
      refinementProvider: "openrouter",
      summaryLanguage: "auto",
      summaryProvider: "openrouter",
      transcriptionLanguage: "auto",
      transcriptionProvider: "openrouter",
      persistMeetingContent: false,
      persistMeetingAudio: false,
      segmentMaxSeconds: 60,
      segmentSilenceMs: 1_000,
      refinementChunkMaxCharacters: 500_000,
      refinementMaxAttempts: 3,
      refinementRetryBaseMs: 1_000,
      refinementRetryMaxMs: 30_000,
      refinementTimeoutMs: 120_000,
      summaryChunkMaxCharacters: 500_000,
      summaryMaxAttempts: 4,
      summaryRetryBaseMs: 1_000,
      summaryRetryMaxMs: 30_000,
      summaryTimeZone: "America/Sao_Paulo",
      summaryTimeoutMs: 120_000,
      storageMode: "local",
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

  it("aceita pt-BR e rejeita variantes não padronizadas ou não suportadas", () => {
    expect(loadConfig({ ...requiredEnvironment, BOT_LANGUAGE: "pt-BR" }).botLanguage).toBe("pt-BR");
    expect(() => loadConfig({ ...requiredEnvironment, BOT_LANGUAGE: "pt-Br" })).toThrow(
      /BOT_LANGUAGE/,
    );
    expect(() => loadConfig({ ...requiredEnvironment, BOT_LANGUAGE: "es" })).toThrow(
      /BOT_LANGUAGE/,
    );
  });

  it("rejeita durações de segmento inválidas", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        SEGMENT_MAX_SECONDS: "0",
      }),
    ).toThrow(/SEGMENT_MAX_SECONDS/);
  });

  it("rejeita parâmetros inválidos do VAD e da consolidação", () => {
    const base = requiredEnvironment;

    expect(() => loadConfig({ ...base, TRANSCRIPTION_VAD_THRESHOLD: "1.1" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_VAD_MIN_SPEECH_MS: "31" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_MERGE_MAX_GAP_MS: "-1" })).toThrow();
    expect(() => loadConfig({ ...base, TRANSCRIPTION_WINDOW_MAX_SECONDS: "4" })).toThrow();
  });

  it("exige credenciais e modelos de transcrição, refinamento e resumo", () => {
    expect(() =>
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_TOKEN: "token",
      }),
    ).toThrow(/OPENROUTER_API_KEY|OPENROUTER_TRANSCRIPTION_MODEL|OPENROUTER_SUMMARY_MODEL/);
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        OPENROUTER_REFINEMENT_MODEL: undefined,
      }),
    ).toThrow(/OPENROUTER_REFINEMENT_MODEL/);
  });

  it("permite escolher provedores locais independentemente por fase", () => {
    const config = loadConfig({
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_TOKEN: "token",
      FASTER_WHISPER_MODEL: "auto",
      OLLAMA_REFINEMENT_MODEL: "qwen3:4b",
      OLLAMA_SUMMARY_MODEL: "auto",
      REFINEMENT_PROVIDER: "ollama",
      SUMMARY_PROVIDER: "ollama",
      TRANSCRIPTION_PROVIDER: "faster-whisper",
    });

    expect(config).toMatchObject({
      fasterWhisperModel: "auto",
      ollamaRefinementModel: "qwen3:4b",
      ollamaSummaryModel: "auto",
      refinementProvider: "ollama",
      summaryProvider: "ollama",
      transcriptionProvider: "faster-whisper",
    });
    expect(config.openRouterApiKey).toBeUndefined();
  });

  it("exige apenas as configurações OpenRouter das fases que usam o provedor", () => {
    expect(() =>
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_TOKEN: "token",
        OPENROUTER_API_KEY: "key",
        OPENROUTER_SUMMARY_MODEL: "google/gemini-3.7-flash",
        REFINEMENT_PROVIDER: "ollama",
        SUMMARY_PROVIDER: "openrouter",
        TRANSCRIPTION_PROVIDER: "faster-whisper",
      }),
    ).not.toThrow();

    expect(() =>
      loadConfig({
        DISCORD_CLIENT_ID: "client-id",
        DISCORD_TOKEN: "token",
        REFINEMENT_PROVIDER: "ollama",
        SUMMARY_PROVIDER: "openrouter",
        TRANSCRIPTION_PROVIDER: "faster-whisper",
      }),
    ).toThrow(/OPENROUTER_API_KEY|OPENROUTER_SUMMARY_MODEL/);
  });

  it("usa idiomas automáticos por padrão e aceita códigos explícitos", () => {
    expect(loadConfig(requiredEnvironment)).toMatchObject({
      summaryLanguage: "auto",
      transcriptionLanguage: "auto",
    });
    expect(
      loadConfig({
        ...requiredEnvironment,
        SUMMARY_LANGUAGE: "pt-BR",
        TRANSCRIPTION_LANGUAGE: "es",
      }),
    ).toMatchObject({ summaryLanguage: "pt-BR", transcriptionLanguage: "es" });
    expect(() =>
      loadConfig({ ...requiredEnvironment, TRANSCRIPTION_LANGUAGE: "português" }),
    ).toThrow(/TRANSCRIPTION_LANGUAGE/);
  });

  it("preserva o escopo de registro por servidor", () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        DISCORD_GUILD_ID: "guild-1",
      }).discordGuildId,
    ).toBe("guild-1");
  });

  it("rejeita limites e fusos inválidos do resumo", () => {
    const base = requiredEnvironment;

    expect(() => loadConfig({ ...base, SUMMARY_CHUNK_MAX_CHARACTERS: "999" })).toThrow();
    expect(() => loadConfig({ ...base, SUMMARY_MAX_ATTEMPTS: "0" })).toThrow();
    expect(() => loadConfig({ ...base, SUMMARY_TIME_ZONE: "Fuso/Inexistente" })).toThrow();
    expect(() => loadConfig({ ...base, REFINEMENT_MAX_ATTEMPTS: "0" })).toThrow();
  });

  it("exige PostgreSQL somente no modo postgres", () => {
    expect(() => loadConfig({ ...requiredEnvironment, STORAGE_MODE: "postgres" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: "mongodb://localhost/summyz",
        STORAGE_MODE: "postgres",
      }),
    ).toThrow(/DATABASE_URL/);
    expect(
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: "postgresql://summyz:secret@localhost:5432/summyz",
        STORAGE_MODE: "postgres",
      }),
    ).toMatchObject({
      databaseUrl: "postgresql://summyz:secret@localhost:5432/summyz",
      storageMode: "postgres",
    });
  });

  it("valida independentemente as opções de persistência", () => {
    expect(() => loadConfig({ ...requiredEnvironment, PERSIST_MEETING_CONTENT: "sim" })).toThrow(
      /PERSIST_MEETING_CONTENT/,
    );
    expect(() => loadConfig({ ...requiredEnvironment, PERSIST_MEETING_AUDIO: "sim" })).toThrow(
      /PERSIST_MEETING_AUDIO/,
    );

    expect(
      loadConfig({
        ...requiredEnvironment,
        PERSIST_MEETING_AUDIO: "true",
        PERSIST_MEETING_CONTENT: "true",
      }),
    ).toMatchObject({ persistMeetingAudio: true, persistMeetingContent: true });
  });
});
