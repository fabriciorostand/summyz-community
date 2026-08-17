import pino, { type DestinationStream, type Logger } from "pino";

const REDACTED_PATHS = [
  "audio",
  "authorization",
  "blocks",
  "cookie",
  "discordToken",
  "entries",
  "headers.authorization",
  "headers.cookie",
  "headers.set-cookie",
  "openRouterApiKey",
  "prompt",
  "refinement",
  "response",
  "summary",
  "token",
  "transcript",
] as const;

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: {
      censor: "[Redacted]",
      paths: [...REDACTED_PATHS],
    },
  };

  return destination === undefined ? pino(options) : pino(options, destination);
}
