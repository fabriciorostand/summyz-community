import { spawnSync } from "node:child_process";

interface CommandResult {
  errorType?: string;
  status: number | null;
}

type CommandRunner = (command: string, arguments_: string[]) => CommandResult;

export type TerminalEncodingResult =
  | { attempted: false; configured: true }
  | { attempted: true; configured: true }
  | { attempted: true; configured: false; errorType: string };

export function configureTerminalEncoding(
  platform: NodeJS.Platform = process.platform,
  runCommand: CommandRunner = runEncodingCommand,
): TerminalEncodingResult {
  if (platform !== "win32") {
    return { attempted: false, configured: true };
  }

  const result = runCommand("chcp.com", ["65001"]);
  if (result.status === 0 && result.errorType === undefined) {
    return { attempted: true, configured: true };
  }

  return {
    attempted: true,
    configured: false,
    errorType: result.errorType ?? "TerminalEncodingCommandFailed",
  };
}

function runEncodingCommand(command: string, arguments_: string[]): CommandResult {
  const result = spawnSync(command, arguments_, {
    stdio: "ignore",
    windowsHide: true,
  });
  return {
    ...(result.error === undefined ? {} : { errorType: result.error.name }),
    status: result.status,
  };
}
