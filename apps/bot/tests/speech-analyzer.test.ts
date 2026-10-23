import { describe, expect, it, vi } from "vitest";

import {
  FullAudioSpeechAnalyzer,
  SileroSpeechAnalyzer,
  type VadSession,
} from "../src/transcription/speech-analyzer.js";

function createVadSession(onProcess: () => Promise<void> | void): VadSession {
  return {
    destroy: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    pause: vi.fn(),
    processAudio: vi.fn(async () => {
      await onProcess();
    }),
    start: vi.fn(),
  };
}

describe("SileroSpeechAnalyzer", () => {
  it("marca voz somente após o evento de fala real do Silero", async () => {
    const samples = new Float32Array(1_536).fill(0.1);
    let processFrames = (): void => undefined;
    const vad = createVadSession(() => processFrames());
    const createVad = vi.fn(async (callbacks) => {
      processFrames = () => {
        callbacks.onFrameProcessed(new Float32Array(512));
        callbacks.onFrameProcessed(new Float32Array(512));
        callbacks.onFrameProcessed(new Float32Array(512));
        callbacks.onSpeechEnd(new Float32Array(1_536));
      };
      return vad;
    });
    const analyzer = new SileroSpeechAnalyzer({
      createVad,
      decodeAudio: vi.fn(async () => samples),
      minSilenceDurationMs: 640,
      minSpeechDurationMs: 96,
      negativeSpeechThreshold: 0.2,
      speechPadMs: 64,
      threshold: 0.5,
    });

    await expect(analyzer.analyze("segment.ogg")).resolves.toEqual({
      containsSpeech: true,
      samples,
      speechRanges: [{ endedAtSample: 1_536, startedAtSample: 0 }],
    });
    expect(vad.start).toHaveBeenCalledOnce();
    expect(createVad).toHaveBeenCalledWith(
      expect.objectContaining({
        onFrameProcessed: expect.any(Function),
        onSpeechEnd: expect.any(Function),
      }),
      {
        minSilenceFrames: 20,
        minimumSpeechFrames: 3,
        negativeSpeechThreshold: 0.2,
        preSpeechPadFrames: 2,
        threshold: 0.5,
      },
    );
    expect(vad.flush).toHaveBeenCalledOnce();
    expect(vad.pause).toHaveBeenCalledOnce();
    await analyzer.close();
    expect(vad.destroy).toHaveBeenCalledOnce();
  });

  it("considera silêncio quando o mínimo de fala não é atingido", async () => {
    const vad = createVadSession(() => undefined);
    const analyzer = new SileroSpeechAnalyzer({
      createVad: vi.fn(async () => vad),
      decodeAudio: vi.fn(async () => new Float32Array(512)),
      minSpeechDurationMs: 96,
      threshold: 0.5,
    });

    await expect(analyzer.analyze("silence.ogg")).resolves.toMatchObject({
      containsSpeech: false,
    });
    await analyzer.close();
  });

  it("serializa inferências para não compartilhar estado do modelo", async () => {
    let active = 0;
    let maximumActive = 0;
    const vad = createVadSession(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
    });
    const analyzer = new SileroSpeechAnalyzer({
      createVad: vi.fn(async () => vad),
      decodeAudio: vi.fn(async () => new Float32Array(512)),
      minSpeechDurationMs: 96,
      threshold: 0.5,
    });

    await Promise.all([analyzer.analyze("a.ogg"), analyzer.analyze("b.ogg")]);

    expect(maximumActive).toBe(1);
    await analyzer.close();
  });

  it("encerra sem carregar o modelo e rejeita novas análises", async () => {
    const createVad = vi.fn(async () => createVadSession(() => undefined));
    const analyzer = new SileroSpeechAnalyzer({
      createVad,
      decodeAudio: vi.fn(async () => new Float32Array(512)),
      minSpeechDurationMs: 96,
      threshold: 0.5,
    });

    await analyzer.close();
    await analyzer.close();

    await expect(analyzer.analyze("late.ogg")).rejects.toThrow(/encerrado/i);
    expect(createVad).not.toHaveBeenCalled();
  });
});

describe("FullAudioSpeechAnalyzer", () => {
  it("preserva todo o áudio sem executar detecção de voz", async () => {
    const samples = new Float32Array([0.1, 0.2]);
    const analyzer = new FullAudioSpeechAnalyzer({ decodeAudio: vi.fn(async () => samples) });

    await expect(analyzer.analyze("segment.ogg")).resolves.toEqual({
      containsSpeech: true,
      samples,
      speechRanges: [{ endedAtSample: 2, startedAtSample: 0 }],
    });
    await expect(analyzer.close()).resolves.toBeUndefined();
  });

  it("preserva como vazio um arquivo sem amostras", async () => {
    const samples = new Float32Array();
    const analyzer = new FullAudioSpeechAnalyzer({ decodeAudio: vi.fn(async () => samples) });

    await expect(analyzer.analyze("empty.ogg")).resolves.toEqual({
      containsSpeech: false,
      samples,
      speechRanges: [],
    });
  });
});
