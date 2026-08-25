import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

export async function convertPcmToOgg(inputPath: string, outputPath: string): Promise<void> {
  // The package is CommonJS, and TypeScript 7 misinterprets its default export in NodeNext mode.
  const executablePath = ffmpegPath as unknown as string | null;
  if (executablePath === null) {
    throw new Error("O binário do FFmpeg não está disponível");
  }

  const arguments_ = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "48k",
    "-ac",
    "1",
    "-y",
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const process_ = spawn(executablePath, arguments_, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorOutput = "";

    process_.stderr.on("data", (chunk: Buffer) => {
      if (errorOutput.length < 4_000) {
        errorOutput += chunk.toString("utf8");
      }
    });
    process_.once("error", reject);
    process_.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`FFmpeg encerrou com código ${String(code)}: ${errorOutput.slice(0, 1_000)}`),
      );
    });
  });
}
