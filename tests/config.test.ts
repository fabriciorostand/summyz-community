import { describe, expect, it } from "vitest";

import { loadConfig, resolveBotConfig } from "../src/config.js";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://summyz:secret@localhost:5432/summyz",
  SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 8).toString("base64url"),
} satisfies NodeJS.ProcessEnv;

describe("loadConfig", () => {
  it("carrega os padrões operacionais sem escolher provedores ou modelos", () => {
    const config = loadConfig(requiredEnvironment);

    expect(config).toMatchObject({
      botLanguage: "en",
      dataDir: "./data",
      databaseUrl: requiredEnvironment.DATABASE_URL,
      localAiDevice: "auto",
      localAiFallback: "none",
      persistMeetingAudio: false,
      persistMeetingContent: true,
      refinementMaxAttempts: 3,
      refinementTimeoutMs: 120_000,
      segmentMaxSeconds: 60,
      segmentSilenceMs: 1_000,
      summaryMaxAttempts: 4,
      summaryTimeZone: "America/Sao_Paulo",
      transcriptionConcurrency: 2,
      transcriptionWindowMaxSeconds: 30,
      voiceReconnectMaxMs: 300_000,
    });
    expect(config).not.toHaveProperty("storageMode");
    expect(config).not.toHaveProperty("fasterWhisperModel");
    expect(config).not.toHaveProperty("summaryProvider");
    expect(config).not.toHaveProperty("transcriptionVadThreshold");
    expect(config).not.toHaveProperty("transcriptionVadMinSpeechMs");
  });

  it("exige PostgreSQL sempre", () => {
    expect(() =>
      loadConfig({ SUMMYZ_SECRETS_KEY: requiredEnvironment.SUMMYZ_SECRETS_KEY }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({ ...requiredEnvironment, DATABASE_URL: "mongodb://localhost/summyz" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("mantém idioma e retenção fora do ambiente", () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        BOT_LANGUAGE: "pt-BR",
        PERSIST_MEETING_AUDIO: "true",
        PERSIST_MEETING_CONTENT: "false",
      }),
    ).toMatchObject({
      botLanguage: "en",
      persistMeetingAudio: false,
      persistMeetingContent: true,
    });
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
      loadConfig({ ...requiredEnvironment, SUMMARY_TIME_ZONE: "Fuso/Inexistente" }),
    ).toThrow();
    expect(() => loadConfig({ ...requiredEnvironment, REFINEMENT_MAX_ATTEMPTS: "0" })).toThrow();
  });

  it("resolve credenciais operacionais do Discord somente a partir do dashboard", () => {
    const bootstrap = loadConfig(requiredEnvironment);

    expect(
      resolveBotConfig(bootstrap, {
        discordApplicationId: "discord-application",
        discordToken: "discord-token",
      }),
    ).toMatchObject({
      discordApplicationId: "discord-application",
      discordToken: "discord-token",
    });
  });

  it("recusa iniciar o bot sem credenciais Discord configuradas no dashboard", () => {
    const bootstrap = loadConfig(requiredEnvironment);

    expect(() =>
      resolveBotConfig(bootstrap, {
        discordApplicationId: null,
        discordToken: "discord-token",
      }),
    ).toThrow(/dashboard/);
    expect(() =>
      resolveBotConfig(bootstrap, {
        discordApplicationId: "discord-application",
        discordToken: undefined,
      }),
    ).toThrow(/dashboard/);
  });
});
