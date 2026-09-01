import { describe, expect, it, vi } from "vitest";

import { api, profileSchema } from "./api";

describe("dashboard API client", () => {
  it("renova a sessão e repete uma requisição autenticada que recebeu 401", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "session_expired" }), { status: 401 }),
      )
      .mockResolvedValueOnce(new Response(undefined, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listGuilds()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejeita perfis sem as chaves de prompt exigidas pelo contrato atual", () => {
    const profile = validProfile();
    const { prompt: _prompt, ...transcription } = profile.transcription;

    expect(profileSchema.safeParse({ ...profile, transcription }).success).toBe(false);
  });
});

function validProfile() {
  return {
    language: "auto",
    name: "Perfil 1",
    profileId: "profile-1",
    profileType: "local" as const,
    refinement: {
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:1.7b",
      prompt: "Revise.",
      provider: "ollama" as const,
    },
    summary: {
      consolidationPrompt: "Consolide.",
      extractionPrompt: "Extraia.",
      generation: {},
      maxChunkCharacters: 500_000,
      model: "qwen3:4b",
      provider: "ollama" as const,
    },
    transcription: {
      batchSize: "auto" as const,
      interSpeechSilenceMs: 0,
      mergeMaxGapMs: 2_000,
      model: "medium",
      prompt: null,
      provider: "faster-whisper" as const,
      vad: {
        enabled: true,
        maxSpeechDurationSeconds: "auto" as const,
        minSilenceDurationMs: "auto" as const,
        minSpeechDurationMs: 0,
        negativeSpeechThreshold: "auto" as const,
        speechPadMs: 400,
        threshold: 0.5,
      },
    },
    translation: null,
    userId: "00000000-0000-4000-8000-000000000001",
  };
}
