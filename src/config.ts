import { z } from "zod";

const environmentSchema = z.object({
  DATA_DIR: z.string().min(1).default("./data"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID é obrigatório"),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN é obrigatório"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  FAILED_RECORDING_RETENTION_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY é obrigatório"),
  OPENROUTER_TRANSCRIPTION_MODEL: z.string().min(1, "OPENROUTER_TRANSCRIPTION_MODEL é obrigatório"),
  TRANSCRIPTION_MODEL_PROFILES_FILE: z
    .string()
    .min(1)
    .default("./config/transcription-model-profiles.json"),
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
  TRANSCRIPTION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  TRANSCRIPTION_MERGE_MAX_GAP_MS: z.coerce.number().int().min(0).max(30_000).default(2_000),
  TRANSCRIPTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  TRANSCRIPTION_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  TRANSCRIPTION_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
  TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
  TRANSCRIPTION_VAD_THRESHOLD: z.coerce.number().min(0.15).max(1).default(0.5),
  TRANSCRIPTION_VAD_MIN_SPEECH_MS: z.coerce.number().int().min(32).max(2_000).default(96),
  TRANSCRIPTION_WINDOW_MAX_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
  VOICE_RECONNECT_MAX_MS: z.coerce
    .number()
    .int("VOICE_RECONNECT_MAX_MS deve ser inteiro")
    .min(1_000, "VOICE_RECONNECT_MAX_MS deve ser maior ou igual a 1000")
    .max(3_600_000, "VOICE_RECONNECT_MAX_MS deve ser menor ou igual a 3600000")
    .default(300_000),
});

export interface AppConfig {
  dataDir: string;
  discordClientId: string;
  discordGuildId?: string;
  discordToken: string;
  failedRecordingRetentionHours: number;
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  openRouterApiKey: string;
  openRouterTranscriptionModel: string;
  segmentMaxSeconds: number;
  segmentSilenceMs: number;
  transcriptionConcurrency: number;
  transcriptionMergeMaxGapMs: number;
  transcriptionModelProfilesFile: string;
  transcriptionMaxAttempts: number;
  transcriptionRetryBaseMs: number;
  transcriptionRetryMaxMs: number;
  transcriptionTimeoutMs: number;
  transcriptionVadThreshold: number;
  transcriptionVadMinSpeechMs: number;
  transcriptionWindowMaxSeconds: number;
  voiceReconnectMaxMs: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    dataDir: parsed.DATA_DIR,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    ...(parsed.DISCORD_GUILD_ID === undefined ? {} : { discordGuildId: parsed.DISCORD_GUILD_ID }),
    discordToken: parsed.DISCORD_TOKEN,
    failedRecordingRetentionHours: parsed.FAILED_RECORDING_RETENTION_HOURS,
    logLevel: parsed.LOG_LEVEL,
    openRouterApiKey: parsed.OPENROUTER_API_KEY,
    openRouterTranscriptionModel: parsed.OPENROUTER_TRANSCRIPTION_MODEL,
    segmentMaxSeconds: parsed.SEGMENT_MAX_SECONDS,
    segmentSilenceMs: parsed.SEGMENT_SILENCE_MS,
    transcriptionConcurrency: parsed.TRANSCRIPTION_CONCURRENCY,
    transcriptionMergeMaxGapMs: parsed.TRANSCRIPTION_MERGE_MAX_GAP_MS,
    transcriptionModelProfilesFile: parsed.TRANSCRIPTION_MODEL_PROFILES_FILE,
    transcriptionMaxAttempts: parsed.TRANSCRIPTION_MAX_ATTEMPTS,
    transcriptionRetryBaseMs: parsed.TRANSCRIPTION_RETRY_BASE_MS,
    transcriptionRetryMaxMs: parsed.TRANSCRIPTION_RETRY_MAX_MS,
    transcriptionTimeoutMs: parsed.TRANSCRIPTION_TIMEOUT_MS,
    transcriptionVadThreshold: parsed.TRANSCRIPTION_VAD_THRESHOLD,
    transcriptionVadMinSpeechMs: parsed.TRANSCRIPTION_VAD_MIN_SPEECH_MS,
    transcriptionWindowMaxSeconds: parsed.TRANSCRIPTION_WINDOW_MAX_SECONDS,
    voiceReconnectMaxMs: parsed.VOICE_RECONNECT_MAX_MS,
  };
}
