import { parseArgs } from "node:util";

import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use PostgreSQL",
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PUBLIC_BASE_URL: z
    .url()
    .refine((value) => new URL(value).origin === value, "PUBLIC_BASE_URL must be an origin")
    .default("http://127.0.0.1:8787"),
  SUMMYZ_SECRETS_KEY: z
    .string()
    .refine(
      isThirtyTwoByteBase64Url,
      "SUMMYZ_SECRETS_KEY must contain exactly 32 bytes encoded as base64url",
    ),
  SUMMYZ_SETUP_TOKEN: z.string().min(32).max(512),
  WEB_HOST: z.string().min(1).default("127.0.0.1"),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(8_787),
  WEB_STATIC_DIR: z.string().min(1).default("web/dist"),
});

export interface WebConfig {
  accessMode: "local" | "public";
  databaseUrl: string;
  host: string;
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  port: number;
  publicBaseUrl: string;
  secretsKey: string;
  setupToken: string;
  staticDirectory: string;
}

export function loadWebConfig(
  environment: NodeJS.ProcessEnv,
  arguments_: readonly string[] = [],
): WebConfig {
  const accessMode = parseAccessMode(arguments_);
  const parsed = environmentSchema.parse(environment);
  if (accessMode === "public") {
    if (!parsed.PUBLIC_BASE_URL.startsWith("https://")) {
      throw new Error("PUBLIC_BASE_URL must use HTTPS in public access mode");
    }
    if (isLoopbackHost(parsed.WEB_HOST)) {
      throw new Error("WEB_HOST must accept non-loopback connections in public access mode");
    }
  }
  return {
    accessMode,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.WEB_HOST,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.WEB_PORT,
    publicBaseUrl: parsed.PUBLIC_BASE_URL,
    secretsKey: parsed.SUMMYZ_SECRETS_KEY,
    setupToken: parsed.SUMMYZ_SETUP_TOKEN,
    staticDirectory: parsed.WEB_STATIC_DIR,
  };
}

function parseAccessMode(arguments_: readonly string[]): "local" | "public" {
  const { tokens, values } = parseArgs({
    args: [...arguments_],
    options: { "access-mode": { type: "string" } },
    strict: true,
    tokens: true,
  });
  if (tokens.filter((token) => token.kind === "option").length > 1) {
    throw new Error("The dashboard access mode must be specified only once");
  }
  return z.enum(["local", "public"]).default("local").parse(values["access-mode"]);
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isThirtyTwoByteBase64Url(value: string): boolean {
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}
