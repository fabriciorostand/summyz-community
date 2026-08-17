import { describe, expect, it, vi } from "vitest";

import { SileroSpeechAnalyzer, type VadSession } from "../src/transcription/speech-analyzer.js";

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
      minSpeechDurationMs: 96,
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
      0.5,
      3,
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
