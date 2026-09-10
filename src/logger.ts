import pino, { type DestinationStream, type Logger } from "pino";

const REDACTED_PATHS = [
  "accessToken",
  "audio",
  "authorization",
  "blocks",
  "clientSecret",
  "cookie",
  "discordToken",
  "entries",
  "headers.authorization",
  "headers.cookie",
  "headers.set-cookie",
  "headers.x-summyz-recovery-token",
  "headers.x-summyz-setup-token",
  "SUMMYZ_SECRETS_KEY",
  "SUMMYZ_SETUP_TOKEN",
  "openRouterApiKey",
  "password",
  "currentPassword",
  "newPassword",
  "installationPassword",
  "prompt",
  "refinement",
  "response",
  "refreshToken",
  "secretsKey",
  "setupToken",
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
