import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const BOT_CONFIGURATION_RESTART_EXIT_CODE = 75;

interface BotSupervisorOptions {
  restartDelayMs?: number;
  startChild(): ChildProcess;
}

export async function superviseBot(options: BotSupervisorOptions): Promise<number> {
  let child: ChildProcess | undefined;
  let stopping = false;
  const forwardSignal = (signal: NodeJS.Signals) => {
    stopping = true;
    if (child === undefined) return;
    if (child.connected) {
      child.send("shutdown", (error) => {
        if (error !== null) child?.kill(signal);
      });
    } else {
      child.kill(signal);
    }
  };
  const interrupt = () => forwardSignal("SIGINT");
  const terminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    while (!stopping) {
      try {
        child = options.startChild();
      } catch (error) {
        writeSupervisorError(error);
        return 1;
      }
      const exitCode = await new Promise<number>((resolve) => {
        child?.once("error", (error) => {
          writeSupervisorError(error);
          resolve(1);
        });
        child?.once("close", (code) => resolve(code ?? 1));
      });
      child = undefined;
      if (stopping) return 0;
      if (exitCode !== BOT_CONFIGURATION_RESTART_EXIT_CODE) return exitCode;
      await delay(options.restartDelayMs ?? 250);
    }
    return 0;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

function writeSupervisorError(error: unknown): void {
  process.stderr.write(
    `${JSON.stringify({
      event: "bot_child_spawn_failed",
      errorType: error instanceof Error ? error.name : typeof error,
    })}\n`,
  );
}
