import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { writePcmAsWav } from "../src/transcription/wav.js";

describe("fallback WAV", () => {
  it("empacota PCM estéreo de 48 kHz sem alterar as amostras", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-wav-"));
    const inputPath = join(directory, "segment.pcm");
    const outputPath = join(directory, "segment.wav");
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    await writeFile(inputPath, pcm);

    await writePcmAsWav(inputPath, outputPath);

    const wav = await readFile(outputPath);
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(2);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("rejeita PCM incompleto para o tamanho de uma amostra estéreo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-wav-"));
    const inputPath = join(directory, "invalid.pcm");
    await writeFile(inputPath, Buffer.from([1, 2, 3]));

    await expect(writePcmAsWav(inputPath, join(directory, "invalid.wav"))).rejects.toThrow(/PCM/i);
  });

  it("não sobrescreve um arquivo WAV existente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-wav-"));
    const inputPath = join(directory, "segment.pcm");
    const outputPath = join(directory, "segment.wav");
    await writeFile(inputPath, Buffer.from([1, 2, 3, 4]));
    await writeFile(outputPath, "preservar");

    await expect(writePcmAsWav(inputPath, outputPath)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(outputPath, "utf8")).resolves.toBe("preservar");
  });
});
