import { createReadStream, createWriteStream } from "node:fs";
import { open, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const CHANNELS = 2;
const SAMPLE_RATE = 48_000;
const BITS_PER_SAMPLE = 16;
const HEADER_SIZE = 44;
const BLOCK_ALIGN = (CHANNELS * BITS_PER_SAMPLE) / 8;

export async function writePcmAsWav(inputPath: string, outputPath: string): Promise<void> {
  const input = await stat(inputPath);
  if (input.size === 0 || input.size % BLOCK_ALIGN !== 0 || input.size > 0xffff_ffff - 36) {
    throw new Error("O arquivo PCM não possui um tamanho válido");
  }

  const header = createHeader(input.size);
  let created = false;
  try {
    const output = await open(outputPath, "wx");
    created = true;
    try {
      await output.write(header, 0, header.length, 0);
    } finally {
      await output.close();
    }
    await pipeline(createReadStream(inputPath), createWriteStream(outputPath, { flags: "a" }));
  } catch (error) {
    if (created) {
      await rm(outputPath, { force: true });
    }
    throw error;
  }
}

function createHeader(dataSize: number): Buffer {
  const header = Buffer.alloc(HEADER_SIZE);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * BLOCK_ALIGN, 28);
  header.writeUInt16LE(BLOCK_ALIGN, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataSize, 40);
  return header;
}
