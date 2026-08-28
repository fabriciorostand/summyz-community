import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must use PostgreSQL",
    ),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PUBLIC_BASE_URL: z.url().optional(),
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
  databaseUrl: string;
  host: string;
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  port: number;
  publicBaseUrl?: string;
  secretsKey: string;
  secureCookies: boolean;
  setupToken: string;
  staticDirectory: string;
}

export function loadWebConfig(environment: NodeJS.ProcessEnv): WebConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.WEB_HOST,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.WEB_PORT,
    ...(parsed.PUBLIC_BASE_URL === undefined ? {} : { publicBaseUrl: parsed.PUBLIC_BASE_URL }),
    secretsKey: parsed.SUMMYZ_SECRETS_KEY,
    secureCookies: parsed.PUBLIC_BASE_URL?.startsWith("https://") ?? false,
    setupToken: parsed.SUMMYZ_SETUP_TOKEN,
    staticDirectory: parsed.WEB_STATIC_DIR,
  };
}

function isThirtyTwoByteBase64Url(value: string): boolean {
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}
