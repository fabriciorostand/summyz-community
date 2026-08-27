import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://summyz:secret@localhost:5432/summyz",
  DISCORD_CLIENT_ID: "client-id",
  DISCORD_TOKEN: "token",
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("carrega os padrões operacionais sem escolher provedores ou modelos", () => {
    const config = loadConfig(requiredEnvironment);

    expect(config).toMatchObject({
      botLanguage: "en",
      dataDir: "./data",
      databaseUrl: requiredEnvironment.DATABASE_URL,
      discordClientId: "client-id",
      discordToken: "token",
      localAiDevice: "auto",
      localAiFallback: "none",
      persistMeetingAudio: false,
      persistMeetingContent: false,
      refinementMaxAttempts: 3,
      refinementTimeoutMs: 120_000,
      segmentMaxSeconds: 60,
      segmentSilenceMs: 1_000,
      summaryMaxAttempts: 4,
      summaryTimeZone: "America/Sao_Paulo",
      transcriptionConcurrency: 2,
      transcriptionVadMinSpeechMs: 96,
      transcriptionVadThreshold: 0.5,
      transcriptionWindowMaxSeconds: 30,
      voiceReconnectMaxMs: 300_000,
    });
    expect(config).not.toHaveProperty("storageMode");
    expect(config).not.toHaveProperty("fasterWhisperModel");
    expect(config).not.toHaveProperty("summaryProvider");
  });

  it("exige PostgreSQL sempre", () => {
    expect(() => loadConfig({ DISCORD_CLIENT_ID: "client-id", DISCORD_TOKEN: "token" })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      loadConfig({ ...requiredEnvironment, DATABASE_URL: "mongodb://localhost/summyz" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("mantém a chave OpenRouter opcional até um perfil selecionar o provedor", () => {
    expect(loadConfig(requiredEnvironment).openRouterApiKey).toBeUndefined();
    expect(loadConfig({ ...requiredEnvironment, OPENROUTER_API_KEY: "key" })).toMatchObject({
      openRouterApiKey: "key",
    });
  });

  it("aceita pt-BR e rejeita idiomas fixos não suportados pelo bot", () => {
    expect(loadConfig({ ...requiredEnvironment, BOT_LANGUAGE: "pt-BR" }).botLanguage).toBe("pt-BR");
    expect(() => loadConfig({ ...requiredEnvironment, BOT_LANGUAGE: "pt-Br" })).toThrow(
      /BOT_LANGUAGE/,
    );
  });

  it("preserva o servidor de desenvolvimento quando configurado", () => {
    expect(loadConfig({ ...requiredEnvironment, DISCORD_GUILD_ID: "guild-1" })).toMatchObject({
      discordGuildId: "guild-1",
    });
  });

  it("configura dispositivo e torna fallback de CPU efetivamente none", () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        LOCAL_AI_DEVICE: "gpu",
        LOCAL_AI_FALLBACK: "cpu",
      }),
    ).toMatchObject({ localAiDevice: "gpu", localAiFallback: "cpu" });
    expect(
      loadConfig({
        ...requiredEnvironment,
        LOCAL_AI_DEVICE: "cpu",
        LOCAL_AI_FALLBACK: "cpu",
      }),
    ).toMatchObject({ localAiDevice: "cpu", localAiFallback: "none" });
  });

  it("rejeita limites operacionais inválidos", () => {
    expect(() => loadConfig({ ...requiredEnvironment, SEGMENT_MAX_SECONDS: "0" })).toThrow();
    expect(() =>
      loadConfig({ ...requiredEnvironment, TRANSCRIPTION_VAD_THRESHOLD: "1.1" }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...requiredEnvironment, SUMMARY_TIME_ZONE: "Fuso/Inexistente" }),
    ).toThrow();
    expect(() => loadConfig({ ...requiredEnvironment, REFINEMENT_MAX_ATTEMPTS: "0" })).toThrow();
  });

  it("valida independentemente as políticas de retenção", () => {
    expect(() => loadConfig({ ...requiredEnvironment, PERSIST_MEETING_CONTENT: "sim" })).toThrow();
    expect(
      loadConfig({
        ...requiredEnvironment,
        PERSIST_MEETING_AUDIO: "true",
        PERSIST_MEETING_CONTENT: "true",
      }),
    ).toMatchObject({ persistMeetingAudio: true, persistMeetingContent: true });
  });
});
