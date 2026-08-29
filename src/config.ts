import { z } from "zod";

const environmentSchema = z.object({
  DATA_DIR: z.string().min(1).default("./data"),
  DATABASE_URL: z
    .url("DATABASE_URL deve ser uma URL válida")
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL deve usar o protocolo postgresql",
    ),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  LOCAL_AI_DEVICE: z.enum(["auto", "gpu", "cpu"]).default("auto"),
  LOCAL_AI_FALLBACK: z.enum(["none", "cpu"]).default("none"),
  SUMMYZ_SECRETS_KEY: z.string().refine(isThirtyTwoByteBase64Url),
  SEGMENT_MAX_SECONDS: z.coerce
    .number()
    .int("SEGMENT_MAX_SECONDS deve ser inteiro")
    .positive("SEGMENT_MAX_SECONDS deve ser maior que zero")
    .max(3_600, "SEGMENT_MAX_SECONDS deve ser menor ou igual a 3600")
    .default(60),
  SEGMENT_SILENCE_MS: z.coerce
    .number()
    .int("SEGMENT_SILENCE_MS deve ser inteiro")
    .min(100, "SEGMENT_SILENCE_MS deve ser maior ou igual a 100")
    .max(30_000, "SEGMENT_SILENCE_MS deve ser menor ou igual a 30000")
    .default(1_000),
  REFINEMENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  REFINEMENT_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  REFINEMENT_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
  REFINEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
  SUMMARY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  SUMMARY_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  SUMMARY_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
  SUMMARY_TIME_ZONE: z
    .string()
    .min(1)
    .refine(isValidTimeZone, "SUMMARY_TIME_ZONE deve ser um fuso IANA válido")
    .default("America/Sao_Paulo"),
  SUMMARY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
  TRANSCRIPTION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  TRANSCRIPTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  TRANSCRIPTION_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  TRANSCRIPTION_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
  TRANSCRIPTION_WINDOW_MAX_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  VOICE_RECONNECT_MAX_MS: z.coerce
    .number()
    .int("VOICE_RECONNECT_MAX_MS deve ser inteiro")
    .min(1_000, "VOICE_RECONNECT_MAX_MS deve ser maior ou igual a 1000")
    .max(3_600_000, "VOICE_RECONNECT_MAX_MS deve ser menor ou igual a 3600000")
    .default(300_000),
});

export interface AppConfig {
  botLanguage: "en" | "pt-BR";
  dataDir: string;
  databaseUrl: string;
  discordClientId: string;
  discordGuildId?: string;
  discordToken: string;
  localAiDevice: z.infer<typeof environmentSchema>["LOCAL_AI_DEVICE"];
  localAiFallback: z.infer<typeof environmentSchema>["LOCAL_AI_FALLBACK"];
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  persistMeetingContent: boolean;
  persistMeetingAudio: boolean;
  segmentMaxSeconds: number;
  segmentSilenceMs: number;
  refinementMaxAttempts: number;
  refinementRetryBaseMs: number;
  refinementRetryMaxMs: number;
  refinementTimeoutMs: number;
  summaryMaxAttempts: number;
  summaryRetryBaseMs: number;
  summaryRetryMaxMs: number;
  summaryTimeZone: string;
  summaryTimeoutMs: number;
  transcriptionConcurrency: number;
  transcriptionMaxAttempts: number;
  transcriptionRetryBaseMs: number;
  transcriptionRetryMaxMs: number;
  transcriptionTimeoutMs: number;
  transcriptionWindowMaxSeconds: number;
  voiceReconnectMaxMs: number;
}

export type BootstrapConfig = Omit<AppConfig, "discordClientId" | "discordToken"> & {
  secretsKey: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv): BootstrapConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    botLanguage: "en",
    dataDir: parsed.DATA_DIR,
    databaseUrl: parsed.DATABASE_URL,
    ...(parsed.DISCORD_GUILD_ID === undefined ? {} : { discordGuildId: parsed.DISCORD_GUILD_ID }),
    localAiDevice: parsed.LOCAL_AI_DEVICE,
    localAiFallback: parsed.LOCAL_AI_DEVICE === "cpu" ? "none" : parsed.LOCAL_AI_FALLBACK,
    logLevel: parsed.LOG_LEVEL,
    persistMeetingContent: true,
    persistMeetingAudio: false,
    secretsKey: parsed.SUMMYZ_SECRETS_KEY,
    segmentMaxSeconds: parsed.SEGMENT_MAX_SECONDS,
    segmentSilenceMs: parsed.SEGMENT_SILENCE_MS,
    refinementMaxAttempts: parsed.REFINEMENT_MAX_ATTEMPTS,
    refinementRetryBaseMs: parsed.REFINEMENT_RETRY_BASE_MS,
    refinementRetryMaxMs: parsed.REFINEMENT_RETRY_MAX_MS,
    refinementTimeoutMs: parsed.REFINEMENT_TIMEOUT_MS,
    summaryMaxAttempts: parsed.SUMMARY_MAX_ATTEMPTS,
    summaryRetryBaseMs: parsed.SUMMARY_RETRY_BASE_MS,
    summaryRetryMaxMs: parsed.SUMMARY_RETRY_MAX_MS,
    summaryTimeZone: parsed.SUMMARY_TIME_ZONE,
    summaryTimeoutMs: parsed.SUMMARY_TIMEOUT_MS,
    transcriptionConcurrency: parsed.TRANSCRIPTION_CONCURRENCY,
    transcriptionMaxAttempts: parsed.TRANSCRIPTION_MAX_ATTEMPTS,
    transcriptionRetryBaseMs: parsed.TRANSCRIPTION_RETRY_BASE_MS,
    transcriptionRetryMaxMs: parsed.TRANSCRIPTION_RETRY_MAX_MS,
    transcriptionTimeoutMs: parsed.TRANSCRIPTION_TIMEOUT_MS,
    transcriptionWindowMaxSeconds: parsed.TRANSCRIPTION_WINDOW_MAX_SECONDS,
    voiceReconnectMaxMs: parsed.VOICE_RECONNECT_MAX_MS,
  };
}

export function resolveBotConfig(
  bootstrap: BootstrapConfig,
  dashboard: {
    discordClientId: string | null;
    discordToken: string | undefined;
  },
): AppConfig {
  if (dashboard.discordClientId === null || dashboard.discordToken === undefined) {
    throw new Error("Discord is not configured in the dashboard");
  }
  const { secretsKey: _secretsKey, ...operational } = bootstrap;
  return {
    ...operational,
    discordClientId: dashboard.discordClientId,
    discordToken: dashboard.discordToken,
  };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function isThirtyTwoByteBase64Url(value: string): boolean {
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}
