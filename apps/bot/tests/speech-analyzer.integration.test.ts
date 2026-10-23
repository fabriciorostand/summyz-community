import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { SileroSpeechAnalyzer } from "../src/transcription/speech-analyzer.js";
import { writePcmAsWav } from "../src/transcription/wav.js";

describe("SileroSpeechAnalyzer com áudio sintético", () => {
  it("não confunde silêncio PCM com voz", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-vad-"));
    const pcmPath = join(directory, "silence.pcm");
    const wavPath = join(directory, "silence.wav");
    await writeFile(pcmPath, Buffer.alloc(48_000 * 2 * 2));
    await writePcmAsWav(pcmPath, wavPath);
    const analyzer = new SileroSpeechAnalyzer({
      maxDurationSeconds: 2,
      minSpeechDurationMs: 96,
      threshold: 0.5,
    });

    try {
      await expect(analyzer.analyze(wavPath)).resolves.toMatchObject({ containsSpeech: false });
    } finally {
      await analyzer.close();
    }
  }, 15_000);
});
