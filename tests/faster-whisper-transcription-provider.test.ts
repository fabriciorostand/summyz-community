import { describe, expect, it, vi } from "vitest";

import { FasterWhisperTranscriptionProvider } from "../src/transcription/faster-whisper-transcription-provider.js";
import {
  IncompatibleTranscriptionResponseError,
  TranscriptionRequestError,
} from "../src/transcription/transcription-provider.js";

describe("FasterWhisperTranscriptionProvider", () => {
  it("envia áudio e modelo ao sidecar privado e converte timestamps", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({
            text: "Hola mundo.",
            words: [
              { end: 0.5, start: 0, word: "Hola" },
              { end: 1, start: 0.5, word: "mundo." },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );
    const provider = new FasterWhisperTranscriptionProvider({
      fetch,
      language: "auto",
      model: "small",
      timeoutMs: 90_000,
    });

    await expect(
      provider.transcribe({ audio: new Uint8Array([1, 2, 3]), format: "ogg" }),
    ).resolves.toEqual({
      attempts: 1,
      pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "Hola mundo." }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "http://faster-whisper:8000/transcribe",
      expect.objectContaining({ method: "POST" }),
    );
    const body = fetch.mock.calls[0]?.[1].body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("model")).toBe("small");
    expect((body as FormData).get("language")).toBe("auto");
  });

  it("rejeita respostas sem timestamps em vez de aceitar um modelo incompatível", async () => {
    const provider = new FasterWhisperTranscriptionProvider({
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ text: "Sem timestamps." }), { status: 200 }),
      ),
      language: "pt-BR",
      model: "small",
      timeoutMs: 90_000,
    });

    await expect(
      provider.transcribe({ audio: new Uint8Array([1]), format: "wav" }),
    ).rejects.toBeInstanceOf(IncompatibleTranscriptionResponseError);
  });

  it("aceita silêncio validado sem palavras", async () => {
    const provider = new FasterWhisperTranscriptionProvider({
      fetch: vi.fn(
        async () => new Response(JSON.stringify({ text: "", words: [] }), { status: 200 }),
      ),
      language: "auto",
      model: "tiny",
      timeoutMs: 90_000,
    });

    await expect(
      provider.transcribe({ audio: new Uint8Array([1]), format: "wav" }),
    ).resolves.toEqual({ attempts: 1, pieces: [] });
  });

  it("classifica rede, status e timestamps inválidos sem expor conteúdo", async () => {
    const offline = new FasterWhisperTranscriptionProvider({
      fetch: vi.fn(async () => {
        throw new Error("offline with sensitive audio");
      }),
      language: "auto",
      model: "tiny",
      timeoutMs: 90_000,
    });
    await expect(
      offline.transcribe({ audio: new Uint8Array([1]), format: "wav" }),
    ).rejects.toBeInstanceOf(TranscriptionRequestError);

    const unavailable = new FasterWhisperTranscriptionProvider({
      fetch: vi.fn(async () => new Response("", { status: 503 })),
      language: "auto",
      model: "tiny",
      timeoutMs: 90_000,
    });
    await expect(
      unavailable.transcribe({ audio: new Uint8Array([1]), format: "wav" }),
    ).rejects.toMatchObject({ retryable: true, status: 503 });

    const invalidTimestamps = new FasterWhisperTranscriptionProvider({
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({ text: "invalid", words: [{ end: 0, start: 1, word: "invalid" }] }),
            { status: 200 },
          ),
      ),
      language: "auto",
      model: "tiny",
      timeoutMs: 90_000,
    });
    await expect(
      invalidTimestamps.transcribe({ audio: new Uint8Array([1]), format: "wav" }),
    ).rejects.toMatchObject({ reason: "invalid_timestamps" });
  });
});
