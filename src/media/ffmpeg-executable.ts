import { execFile } from "node:child_process";
import { posix, win32 } from "node:path";
import { promisify } from "node:util";

interface FfmpegCommandResult {
  stderr: string;
  stdout: string;
}

export type FfmpegCommandRunner = (
  executable: string,
  arguments_: readonly string[],
) => Promise<FfmpegCommandResult>;

interface ResolveFfmpegExecutableOptions {
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

interface ValidateFfmpegExecutableOptions extends ResolveFfmpegExecutableOptions {
  run?: FfmpegCommandRunner;
}

const execFileAsync = promisify(execFile);

export function resolveFfmpegExecutable(options: ResolveFfmpegExecutableOptions = {}): string {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const configured = environment.FFMPEG_PATH?.trim();
  if (configured === undefined || configured.length === 0) {
    return platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  }

  const isAbsolute =
    platform === "win32" ? win32.isAbsolute(configured) : posix.isAbsolute(configured);
  if (!isAbsolute) {
    throw new Error("FFMPEG_PATH must be an absolute path");
  }
  return configured;
}

export async function validateFfmpegExecutable(
  options: ValidateFfmpegExecutableOptions = {},
): Promise<string> {
  const executable = resolveFfmpegExecutable(options);
  const run = options.run ?? runCommand;
  let result: FfmpegCommandResult;
  try {
    result = await run(executable, ["-hide_banner", "-encoders"]);
  } catch (error: unknown) {
    throw new Error("FFmpeg is unavailable or could not be executed", { cause: error });
  }
  if (!/\blibopus\b/u.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error("FFmpeg must provide the libopus encoder");
  }
  return executable;
}

async function runCommand(
  executable: string,
  arguments_: readonly string[],
): Promise<FfmpegCommandResult> {
  const result = await execFileAsync(executable, [...arguments_], {
    encoding: "utf8",
    maxBuffer: 4 * 1_024 * 1_024,
    timeout: 10_000,
    windowsHide: true,
  });
  return { stderr: result.stderr, stdout: result.stdout };
}
