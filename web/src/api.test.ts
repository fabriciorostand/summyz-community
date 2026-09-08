import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, type Profile, profileSchema } from "./api";

afterEach(() => vi.unstubAllGlobals());

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

  it("serializes all mutation requests at the API boundary", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await api.completeDiscord("code value", "state value");
    await api.deleteProfile("profile-1");
    await api.disconnectDiscord();
    await api.forgotPassword("owner@example.com");
    await api.login("owner@example.com", "password");
    await api.logout();
    await api.register("owner@example.com", "password", "pt-BR");
    await api.resetPassword("token", "new-password");
    await api.setActiveProfile("guild-1", "profile-1");
    await api.setup("setup-token", { owner: "owner@example.com" });
    await api.updateForum("guild-1", null);
    await api.updateForum("guild-1", { forumId: "forum-1", tagId: "tag-1" });
    await api.updateGuildSettings("guild-1", {
      botLanguage: "en",
      persistMeetingAudio: true,
      persistMeetingContent: false,
    });
    await api.updateInstallationSettings({
      discordClientId: null,
      publicBaseUrl: null,
      registrationEnabled: false,
      smtp: null,
    });
    await api.updateProfile(validProfile());
    await api.updateRecordingPermissions("guild-1", {
      roleIds: ["role-1"],
      userIds: ["user-1"],
    });
    await api.updateSecret("smtp_password", "secret");
    await api.verifyEmail("verification-token");

    expect(fetchMock).toHaveBeenCalledTimes(18);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/setup",
      expect.objectContaining({
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const setupHeaders = findRequestHeaders(fetchMock, "/api/setup");
    expect(setupHeaders.get("content-type")).toBe("application/json");
    expect(setupHeaders.get("x-summyz-setup-token")).toBe("setup-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guilds/guild-1/recording-permissions",
      expect.objectContaining({
        body: JSON.stringify({ roleIds: ["role-1"], userIds: ["user-1"] }),
        method: "PUT",
      }),
    );
  });

  it("returns meeting exports as text without trying to parse JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("Voice channel: planning")),
    );

    await expect(api.getMeetingExport("guild-1", "meeting-1")).resolves.toBe(
      "Voice channel: planning",
    );
  });

  it("reports stable errors when refresh and response parsing fail", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(undefined, { status: 401 }))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.listGuilds()).rejects.toEqual(new ApiError(401, "request_failed"));
  });

  it("validates the Discord authorization URL returned by the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ authorizationUrl: "https://discord.com/oauth2/authorize" }),
        ),
    );

    await expect(api.connectDiscord()).resolves.toEqual({
      authorizationUrl: "https://discord.com/oauth2/authorize",
    });
  });
});

function findRequestHeaders(
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>,
  path: string,
): Headers {
  const call = fetchMock.mock.calls.find(([input]) => String(input) === path);
  if (call === undefined) throw new Error(`Expected request to ${path}`);
  const [, init] = call;
  if (!(init?.headers instanceof Headers)) throw new Error(`Expected Headers for ${path}`);
  return init.headers;
}

function validProfile(): Profile {
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
