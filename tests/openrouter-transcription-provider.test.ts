import { describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";
import {
  IncompatibleTranscriptionResponseError,
  OpenRouterTranscriptionProvider,
  TranscriptionRequestError,
} from "../src/transcription/openrouter-transcription-provider.js";
import type { TranscriptionModelProfile } from "../src/transcription/transcription-model-profile.js";

const whisperProfile: TranscriptionModelProfile = {
  interSpeechSilenceMs: 0,
  language: "pt-BR",
  temperature: 0,
  timestampMode: "word",
};

const voxtralProfile: TranscriptionModelProfile = {
  interSpeechSilenceMs: 0,
  temperature: 0,
  timestampMode: "batch",
};

function createProvider(
  fetch_: (url: string, init: RequestInit) => Promise<Response>,
  sleep = vi.fn(async () => undefined),
  model = "openai/whisper-1",
  profile = whisperProfile,
) {
  return {
    provider: new OpenRouterTranscriptionProvider({
      apiKey: "segredo",
      fetch: fetch_,
      maxAttempts: 4,
      model,
      profile,
      random: () => 0,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 90_000,
    }),
    sleep,
  };
}

describe("OpenRouterTranscriptionProvider", () => {
  it("envia pt-BR, modelo configurado e solicita timestamps detalhados", async () => {
    const fetch_ = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(init.headers).toMatchObject({ Authorization: "Bearer segredo" });
      expect(body).toEqual({
        input_audio: { data: Buffer.from("audio").toString("base64"), format: "ogg" },
        language: "pt-BR",
        model: "openai/whisper-1",
        response_format: "verbose_json",
        temperature: 0,
        timestamp_granularities: ["word", "segment"],
      });
      return Response.json({
        segments: [{ end: 1.5, start: 0.25, text: " Olá, mundo. " }],
        text: "Olá, mundo.",
      });
    });
    const { provider } = createProvider(fetch_);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).resolves.toEqual({
      attempts: 1,
      pieces: [{ endedAtMs: 1_500, startedAtMs: 250, text: "Olá, mundo." }],
    });
  });

  it("usa o perfil JSON e o intervalo do lote para o Voxtral sem timestamps", async () => {
    const fetch_ = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
        input_audio: { data: Buffer.from("audio").toString("base64"), format: "wav" },
        model: "mistralai/voxtral-mini-transcribe",
        response_format: "json",
        temperature: 0,
      });
      return Response.json({ text: "Não, concordo." });
    });
    const { provider } = createProvider(
      fetch_,
      vi.fn(async () => undefined),
      "mistralai/voxtral-mini-transcribe",
      voxtralProfile,
    );

    await expect(
      provider.transcribe({
        audio: Buffer.from("audio"),
        audioDurationMs: 1_248,
        format: "wav",
      }),
    ).resolves.toEqual({
      attempts: 1,
      pieces: [{ endedAtMs: 1_248, startedAtMs: 0, text: "Não, concordo." }],
    });
  });

  it("encaminha somente as opções específicas presentes no perfil ativo", async () => {
    const fetch_ = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        language: "pt-BR",
        model: "deepgram/nova-3",
        provider: {
          options: {
            deepgram: { smart_format: true, utterances: true },
          },
        },
      });
      return Response.json({
        text: "Não, concordo.",
        words: [
          { end: 0.2, start: 0, word: "Não," },
          { end: 0.6, start: 0.25, word: "concordo." },
        ],
      });
    });
    const profile: TranscriptionModelProfile = {
      interSpeechSilenceMs: 350,
      language: "pt-BR",
      providerOptions: { deepgram: { smart_format: true, utterances: true } },
      temperature: 0,
      timestampMode: "word",
    };
    const { provider } = createProvider(fetch_, undefined, "deepgram/nova-3", profile);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "wav" }),
    ).resolves.toMatchObject({
      pieces: [{ endedAtMs: 600, startedAtMs: 0, text: "Não, concordo." }],
    });
  });

  it("encaminha o prompt opcional sem transformá-lo em vocabulário controlado", async () => {
    const prompt =
      "Transcreva literalmente em português brasileiro, sem resumir ou completar as falas.";
    const fetch_ = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: "openai/gpt-transcribe",
        prompt,
      });
      return Response.json({ text: "Uma fala." });
    });
    const profile: TranscriptionModelProfile = {
      interSpeechSilenceMs: 350,
      language: "pt",
      mergeMaxGapMs: 0,
      prompt,
      temperature: 0,
      timestampMode: "batch",
    };
    const { provider } = createProvider(fetch_, undefined, "openai/gpt-transcribe", profile);

    await expect(
      provider.transcribe({
        audio: Buffer.from("audio"),
        audioDurationMs: 1_000,
        format: "wav",
      }),
    ).resolves.toMatchObject({ pieces: [{ text: "Uma fala." }] });
  });

  it("retenta falhas transitórias com backoff e respeita o limite", async () => {
    const fetch_ = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ segments: [{ end: 1, start: 0, text: "Certo" }], text: "Certo" }),
      );
    const { provider, sleep } = createProvider(fetch_);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "wav" }),
    ).resolves.toMatchObject({ attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(1_000);
    expect(fetch_).toHaveBeenCalledTimes(2);
  });

  it("não retenta requisições inválidas nem inclui a resposta no erro", async () => {
    const fetch_ = vi.fn(async () =>
      Response.json({ error: { message: "conteúdo sensível" } }, { status: 400 }),
    );
    const { provider, sleep } = createProvider(fetch_);

    const error = await provider
      .transcribe({ audio: Buffer.from("audio"), format: "ogg" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TranscriptionRequestError);
    expect(String(error)).not.toContain("conteúdo sensível");
    expect(fetch_).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rejeita respostas sem timestamps", async () => {
    const { provider } = createProvider(async () => Response.json({ text: "Sem timestamps" }));

    const error = await provider
      .transcribe({ audio: Buffer.from("audio"), format: "ogg" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IncompatibleTranscriptionResponseError);
    expect(error).toMatchObject({ reason: "missing_timestamps" });
    expect(String(error)).not.toContain("Sem timestamps");
  });

  it("agrupa timestamps por palavra em trechos legíveis", async () => {
    const { provider } = createProvider(async () =>
      Response.json({
        text: "Olá mundo. Tudo bem?",
        words: [
          { end: 0.4, start: 0, word: "Olá" },
          { end: 0.8, start: 0.5, word: "mundo." },
          { end: 1.4, start: 1, word: "Tudo" },
          { end: 1.8, start: 1.5, word: "bem?" },
        ],
      }),
    );

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).resolves.toMatchObject({
      pieces: [
        { endedAtMs: 800, startedAtMs: 0, text: "Olá mundo." },
        { endedAtMs: 1_800, startedAtMs: 1_000, text: "Tudo bem?" },
      ],
    });
  });

  it("prioriza palavras quando a resposta também contém segmentos incompatíveis", async () => {
    const { provider } = createProvider(async () =>
      Response.json({
        segments: [{ end: 0, start: 0, text: "Segmento inválido" }],
        text: "Olá.",
        words: [{ end: 0.5, start: 0.1, word: "Olá." }],
      }),
    );

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "wav" }),
    ).resolves.toMatchObject({
      pieces: [{ endedAtMs: 500, startedAtMs: 100, text: "Olá." }],
    });
  });

  it("usa segmentos válidos quando os timestamps por palavra são incompatíveis", async () => {
    const fetch_ = vi.fn(async () =>
      Response.json({
        segments: [{ end: 1.25, start: 0.2, text: "Olá, mundo." }],
        text: "Olá, mundo.",
        words: [
          { end: 0.4, start: 0.1, word: "Olá," },
          { end: 0.4, start: 0.4, word: "mundo." },
        ],
      }),
    );
    const { provider, sleep } = createProvider(fetch_);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "wav" }),
    ).resolves.toEqual({
      attempts: 1,
      pieces: [{ endedAtMs: 1_250, startedAtMs: 200, text: "Olá, mundo." }],
    });
    expect(fetch_).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retenta timestamps incompatíveis e aceita uma resposta posterior válida", async () => {
    const fetch_ = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({
          segments: [{ end: 1, start: 1, text: "Inválido" }],
          text: "Inválido",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          segments: [{ end: 1.5, start: 0.25, text: "Válido" }],
          text: "Válido",
        }),
      );
    const { provider, sleep } = createProvider(fetch_);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "wav" }),
    ).resolves.toEqual({
      attempts: 2,
      pieces: [{ endedAtMs: 1_500, startedAtMs: 250, text: "Válido" }],
    });
    expect(fetch_).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("falha sem aproximar timestamps após esgotar respostas incompatíveis", async () => {
    const fetch_ = vi.fn(async () =>
      Response.json({
        segments: [{ end: 0.5, start: 0.5, text: "Inválido" }],
        text: "Inválido",
        words: [{ end: 0.25, start: 0.25, word: "Inválido" }],
      }),
    );
    const { provider, sleep } = createProvider(fetch_);

    await expect(
      provider.transcribe({
        audio: Buffer.from("audio"),
        audioDurationMs: 5_000,
        format: "wav",
      }),
    ).rejects.toMatchObject({ reason: "invalid_timestamps" });
    expect(fetch_).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it("aceita um segmento sem fala quando o provedor confirma texto vazio", async () => {
    const { provider } = createProvider(async () => Response.json({ text: "", words: [] }));

    await expect(
      provider.transcribe({ audio: Buffer.from("ruído"), format: "ogg" }),
    ).resolves.toMatchObject({ pieces: [] });
  });

  it("aceita marcador temporal vazio quando o provedor não reconhece fala", async () => {
    const { provider } = createProvider(async () =>
      Response.json({ segments: [{ end: 0.86, start: 0, text: "" }], text: "" }),
    );

    await expect(
      provider.transcribe({ audio: Buffer.from("ruído"), format: "wav" }),
    ).resolves.toMatchObject({ pieces: [] });
  });

  it("esgota quatro tentativas, respeita Retry-After e registra os retries", async () => {
    const fetch_ = vi.fn(
      async () => new Response(null, { headers: { "Retry-After": "2" }, status: 503 }),
    );
    const sleep = vi.fn(async () => undefined);
    const provider = new OpenRouterTranscriptionProvider({
      apiKey: "segredo",
      fetch: fetch_,
      logger: createLogger("silent"),
      maxAttempts: 4,
      model: "openai/whisper-1",
      profile: whisperProfile,
      random: () => 0,
      retryBaseMs: 1_000,
      retryMaxMs: 30_000,
      sleep,
      timeoutMs: 90_000,
    });

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch_).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2_000);
    expect(sleep).toHaveBeenNthCalledWith(3, 4_000);
  });

  it("retenta uma falha de rede sem expor o erro original", async () => {
    const fetch_ = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("segredo na rede"))
      .mockResolvedValueOnce(
        Response.json({ segments: [{ end: 1, start: 0, text: "Pronto" }], text: "Pronto" }),
      );
    const { provider } = createProvider(fetch_);

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).resolves.toMatchObject({ attempts: 2 });
  });

  it("rejeita JSON inválido e timestamps inconsistentes", async () => {
    const malformed = createProvider(async () => new Response("não é JSON")).provider;
    await expect(
      malformed.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).rejects.toMatchObject({
      reason: "invalid_json",
    });

    const invalidTimestamp = createProvider(async () =>
      Response.json({ segments: [{ end: 1, start: 1, text: "Inválido" }], text: "Inválido" }),
    ).provider;
    await expect(
      invalidTimestamp.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).rejects.toMatchObject({ reason: "invalid_timestamps" });
  });

  it("classifica uma estrutura de resposta inválida sem expor seu conteúdo", async () => {
    const sensitiveContent = "conteúdo sensível retornado pelo provedor";
    const { provider } = createProvider(async () =>
      Response.json({ response: sensitiveContent, text: 123 }),
    );

    const error = await provider
      .transcribe({ audio: Buffer.from("audio"), format: "ogg" })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reason: "invalid_response_shape" });
    expect(JSON.stringify(error)).not.toContain(sensitiveContent);
    expect(String(error)).not.toContain(sensitiveContent);
  });

  it("fecha o último grupo de palavras mesmo sem pontuação", async () => {
    const { provider } = createProvider(async () =>
      Response.json({
        text: "sem pontuação",
        words: [
          { end: 0.5, start: 0, word: "sem" },
          { end: 1, start: 0.6, word: "pontuação" },
        ],
      }),
    );

    await expect(
      provider.transcribe({ audio: Buffer.from("audio"), format: "ogg" }),
    ).resolves.toMatchObject({
      pieces: [{ endedAtMs: 1_000, startedAtMs: 0, text: "sem pontuação" }],
    });
  });
});
