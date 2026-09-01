import { describe, expect, it, vi } from "vitest";

import {
  resolveFfmpegExecutable,
  validateFfmpegExecutable,
} from "../src/media/ffmpeg-executable.js";

describe("FFmpeg executable", () => {
  it("usa um caminho absoluto configurado explicitamente", () => {
    expect(
      resolveFfmpegExecutable({
        environment: { FFMPEG_PATH: "/opt/ffmpeg/bin/ffmpeg" },
        platform: "linux",
      }),
    ).toBe("/opt/ffmpeg/bin/ffmpeg");
    expect(
      resolveFfmpegExecutable({
        environment: { FFMPEG_PATH: "C:\\ffmpeg\\bin\\ffmpeg.exe" },
        platform: "win32",
      }),
    ).toBe("C:\\ffmpeg\\bin\\ffmpeg.exe");
  });

  it("usa o PATH do sistema quando não há configuração explícita", () => {
    expect(resolveFfmpegExecutable({ environment: {}, platform: "linux" })).toBe("ffmpeg");
    expect(resolveFfmpegExecutable({ environment: {}, platform: "win32" })).toBe("ffmpeg.exe");
  });

  it("rejeita caminho relativo configurado", () => {
    expect(() =>
      resolveFfmpegExecutable({
        environment: { FFMPEG_PATH: "tools/ffmpeg" },
        platform: "linux",
      }),
    ).toThrow(/absolute/i);
  });

  it("valida a disponibilidade do encoder libopus antes de iniciar", async () => {
    const run = vi.fn(async () => ({ stdout: " A..... libopus libopus Opus", stderr: "" }));

    await expect(
      validateFfmpegExecutable({
        environment: { FFMPEG_PATH: "/opt/ffmpeg/bin/ffmpeg" },
        platform: "linux",
        run,
      }),
    ).resolves.toBe("/opt/ffmpeg/bin/ffmpeg");
    expect(run).toHaveBeenCalledWith("/opt/ffmpeg/bin/ffmpeg", ["-hide_banner", "-encoders"]);
  });

  it("interrompe quando a instalação não oferece libopus", async () => {
    await expect(
      validateFfmpegExecutable({
        environment: {},
        platform: "linux",
        run: vi.fn(async () => ({ stdout: " A..... aac AAC", stderr: "" })),
      }),
    ).rejects.toThrow(/libopus/i);
  });
});
