import type { Client } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
  createTranscriptionFailureMessage,
  notifyTranscriptionFailure,
} from "../src/discord/transcription-notifier.js";
import { createLogger } from "../src/logger.js";
import { createManifest } from "../src/recording/manifest.js";

describe("aviso de falha da transcrição", () => {
  it("informa apenas o resultado relevante sem detalhes internos", () => {
    const message = createTranscriptionFailureMessage("meeting-1", "pt-BR");

    expect(message).toContain("Não foi possível transcrever esta chamada");
    expect(message).toContain("meeting-1");
    expect(message).not.toMatch(/FFmpeg|PCM|WAV|stack|caminho|conversão/i);
  });

  it("envia a mensagem ao canal persistido e tolera canais indisponíveis", async () => {
    const manifest = createManifest({
      guildId: "guild-1",
      meetingId: "meeting-1",
      notificationChannelId: "text-1",
      startedAt: "2026-08-16T20:00:00.000Z",
      voiceChannelId: "voice-1",
    });
    const send = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ isSendable: () => true, send })
      .mockResolvedValueOnce({ isSendable: () => false })
      .mockRejectedValueOnce(new Error("canal indisponível"))
      .mockRejectedValueOnce("canal indisponível");
    const client = { channels: { fetch } } as unknown as Client;

    await notifyTranscriptionFailure(client, createLogger("silent"), manifest, "pt-BR");
    await notifyTranscriptionFailure(client, createLogger("silent"), manifest, "pt-BR");
    await expect(
      notifyTranscriptionFailure(client, createLogger("silent"), manifest, "pt-BR"),
    ).resolves.toBeUndefined();
    await expect(
      notifyTranscriptionFailure(client, createLogger("silent"), manifest, "pt-BR"),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith({
      content: createTranscriptionFailureMessage("meeting-1", "pt-BR"),
    });
  });

  it("gera o aviso público em inglês sem expor detalhes internos", () => {
    const message = createTranscriptionFailureMessage("meeting-1", "en");

    expect(message).toContain("Unable to transcribe this voice call");
    expect(message).toContain("meeting-1");
    expect(message).not.toMatch(/FFmpeg|PCM|WAV|stack|path|conversion/i);
  });
});
