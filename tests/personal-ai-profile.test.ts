import { describe, expect, it } from "vitest";

import {
  aiProfileSchema,
  createInitialAiProfile,
  externalAiProfileSchema,
  resolveAiProfile,
} from "../src/ai-profile.js";

describe("perfis pessoais de IA", () => {
  it("creates explicit localized templates without provisioning profiles", () => {
    const profiles = [
      createInitialAiProfile("user-1", "external", "pt-BR"),
      createInitialAiProfile("user-1", "local", "pt-BR"),
    ];

    expect(profiles).toHaveLength(2);
    expect(
      profiles.map(({ name, profileType, userId }) => ({ name, profileType, userId })),
    ).toEqual([
      { name: "Perfil 1", profileType: "external", userId: "user-1" },
      { name: "Perfil 1", profileType: "local", userId: "user-1" },
    ]);
    expect(profiles[0]).toMatchObject({
      refinement: {
        prompt: expect.stringContaining("revisor conservador"),
        provider: "openrouter",
      },
      summary: {
        consolidationPrompt: expect.stringContaining("idioma predominante"),
        extractionPrompt: expect.stringContaining("idioma predominante"),
        provider: "openrouter",
      },
      transcription: {
        prompt: null,
        provider: "openrouter",
        vad: {
          enabled: true,
          minSilenceDurationMs: 768,
          minSpeechDurationMs: 96,
          negativeSpeechThreshold: "auto",
          speechPadMs: 96,
          threshold: 0.5,
        },
      },
    });
    expect(profiles[1]).toMatchObject({
      refinement: { prompt: expect.stringContaining("revisor conservador"), provider: "ollama" },
      summary: {
        consolidationPrompt: expect.stringContaining("idioma predominante"),
        extractionPrompt: expect.stringContaining("idioma predominante"),
        provider: "ollama",
      },
      transcription: {
        prompt: null,
        provider: "faster-whisper",
        vad: {
          enabled: true,
          maxSpeechDurationSeconds: "auto",
          minSilenceDurationMs: "auto",
          minSpeechDurationMs: 0,
          negativeSpeechThreshold: "auto",
          speechPadMs: 400,
          threshold: 0.5,
        },
      },
    });
  });

  it("localiza os nomes iniciais em inglês", () => {
    expect(createInitialAiProfile("user-1", "external", "en").name).toBe("Profile 1");
  });

  it("rejeita combinações híbridas entre o tipo do perfil e seus provedores", () => {
    const local = createInitialAiProfile("user-1", "local", "pt-BR");

    expect(() =>
      aiProfileSchema.parse({
        ...local,
        refinement: { ...local.refinement, provider: "openrouter" },
      }),
    ).toThrow();
  });

  it("fixa o tipo e a configuração efetiva do VAD no manifesto", () => {
    const external = createInitialAiProfile("user-1", "external", "pt-BR");

    const resolved = resolveAiProfile(
      externalAiProfileSchema.parse({
        ...external,
        refinement: { ...external.refinement, model: "vendor/refinement" },
        summary: { ...external.summary, model: "vendor/summary" },
        transcription: { ...external.transcription, model: "vendor/transcription" },
      }),
    );

    expect(resolved).toMatchObject({
      profileType: "external",
      transcription: {
        provider: "openrouter",
        vad: {
          enabled: true,
          minSilenceDurationMs: 768,
          minSpeechDurationMs: 96,
        },
      },
    });
  });
});
