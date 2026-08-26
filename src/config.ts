import { z } from "zod";

const environmentSchema = z
  .object({
    BOT_LANGUAGE: z
      .enum(["en", "pt-br"], { error: "BOT_LANGUAGE must be en or pt-br" })
      .default("en"),
    DATA_DIR: z.string().min(1).default("./data"),
    DATABASE_URL: z
      .url("DATABASE_URL deve ser uma URL válida")
      .refine(
        (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "DATABASE_URL deve usar o protocolo postgresql",
      )
      .optional(),
    DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID é obrigatório"),
    DISCORD_GUILD_ID: z.string().min(1).optional(),
    DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN é obrigatório"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    FASTER_WHISPER_MODEL: z.string().min(1).default("auto"),
    OLLAMA_REFINEMENT_MODEL: z.string().min(1).default("auto"),
    OLLAMA_SUMMARY_MODEL: z.string().min(1).default("auto"),
    OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY é obrigatório").optional(),
    OPENROUTER_REFINEMENT_MODEL: z
      .string()
      .min(1, "OPENROUTER_REFINEMENT_MODEL é obrigatório")
      .optional(),
    OPENROUTER_SUMMARY_MODEL: z
      .string()
      .min(1, "OPENROUTER_SUMMARY_MODEL é obrigatório")
      .optional(),
    OPENROUTER_TRANSCRIPTION_MODEL: z
      .string()
      .min(1, "OPENROUTER_TRANSCRIPTION_MODEL é obrigatório")
      .optional(),
    PERSIST_MEETING_CONTENT: z
      .enum(["true", "false"], {
        error: "PERSIST_MEETING_CONTENT deve ser true ou false",
      })
      .default("false")
      .transform((value) => value === "true"),
    PERSIST_MEETING_AUDIO: z
      .enum(["true", "false"], {
        error: "PERSIST_MEETING_AUDIO deve ser true ou false",
      })
      .default("false")
      .transform((value) => value === "true"),
    STORAGE_MODE: z.enum(["local", "postgres"]).default("local"),
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
    REFINEMENT_CHUNK_MAX_CHARACTERS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(10_000_000)
      .default(500_000),
    REFINEMENT_PROVIDER: z.enum(["openrouter", "ollama"]).default("openrouter"),
    REFINEMENT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    REFINEMENT_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    REFINEMENT_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
    REFINEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
    SUMMARY_CHUNK_MAX_CHARACTERS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(10_000_000)
      .default(500_000),
    SUMMARY_LANGUAGE: z
      .string()
      .refine(isSupportedLanguageSetting, "SUMMARY_LANGUAGE deve ser auto ou um código BCP 47")
      .default("auto"),
    SUMMARY_PROVIDER: z.enum(["openrouter", "ollama"]).default("openrouter"),
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
    TRANSCRIPTION_LANGUAGE: z
      .string()
      .refine(
        isSupportedLanguageSetting,
        "TRANSCRIPTION_LANGUAGE deve ser auto ou um código BCP 47",
      )
      .default("auto"),
    TRANSCRIPTION_MERGE_MAX_GAP_MS: z.coerce.number().int().min(0).max(30_000).default(2_000),
    TRANSCRIPTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
    TRANSCRIPTION_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    TRANSCRIPTION_RETRY_MAX_MS: z.coerce.number().int().min(100).max(300_000).default(30_000),
    TRANSCRIPTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(90_000),
    TRANSCRIPTION_VAD_THRESHOLD: z.coerce.number().min(0.15).max(1).default(0.5),
    TRANSCRIPTION_VAD_MIN_SPEECH_MS: z.coerce.number().int().min(32).max(2_000).default(96),
    TRANSCRIPTION_WINDOW_MAX_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
    TRANSCRIPTION_PROVIDER: z.enum(["openrouter", "faster-whisper"]).default("openrouter"),
    VOICE_RECONNECT_MAX_MS: z.coerce
      .number()
      .int("VOICE_RECONNECT_MAX_MS deve ser inteiro")
      .min(1_000, "VOICE_RECONNECT_MAX_MS deve ser maior ou igual a 1000")
      .max(3_600_000, "VOICE_RECONNECT_MAX_MS deve ser menor ou igual a 3600000")
      .default(300_000),
  })
  .superRefine((environment, context) => {
    if (environment.STORAGE_MODE === "postgres" && environment.DATABASE_URL === undefined) {
      context.addIssue({
        code: "custom",
        message: "DATABASE_URL é obrigatória quando STORAGE_MODE=postgres",
        path: ["DATABASE_URL"],
      });
    }

    const openRouterRequirements = [
      environment.TRANSCRIPTION_PROVIDER === "openrouter"
        ? (["OPENROUTER_TRANSCRIPTION_MODEL", environment.OPENROUTER_TRANSCRIPTION_MODEL] as const)
        : undefined,
      environment.REFINEMENT_PROVIDER === "openrouter"
        ? (["OPENROUTER_REFINEMENT_MODEL", environment.OPENROUTER_REFINEMENT_MODEL] as const)
        : undefined,
      environment.SUMMARY_PROVIDER === "openrouter"
        ? (["OPENROUTER_SUMMARY_MODEL", environment.OPENROUTER_SUMMARY_MODEL] as const)
        : undefined,
    ].filter((requirement) => requirement !== undefined);

    if (openRouterRequirements.length > 0 && environment.OPENROUTER_API_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "OPENROUTER_API_KEY é obrigatória quando alguma fase usa OpenRouter",
        path: ["OPENROUTER_API_KEY"],
      });
    }

    for (const [name, value] of openRouterRequirements) {
      if (value === undefined) {
        context.addIssue({
          code: "custom",
          message: `${name} é obrigatório para a fase configurada com OpenRouter`,
          path: [name],
        });
      }
    }
  });

export interface AppConfig {
  botLanguage: z.infer<typeof environmentSchema>["BOT_LANGUAGE"];
  dataDir: string;
  databaseUrl?: string;
  discordClientId: string;
  discordGuildId?: string;
  discordToken: string;
  fasterWhisperModel: string;
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  ollamaRefinementModel: string;
  ollamaSummaryModel: string;
  openRouterApiKey?: string;
  openRouterRefinementModel?: string;
  openRouterSummaryModel?: string;
  openRouterTranscriptionModel?: string;
  persistMeetingContent: boolean;
  persistMeetingAudio: boolean;
  segmentMaxSeconds: number;
  segmentSilenceMs: number;
  refinementChunkMaxCharacters: number;
  refinementMaxAttempts: number;
  refinementProvider: z.infer<typeof environmentSchema>["REFINEMENT_PROVIDER"];
  refinementRetryBaseMs: number;
  refinementRetryMaxMs: number;
  refinementTimeoutMs: number;
  summaryChunkMaxCharacters: number;
  summaryLanguage: string;
  summaryMaxAttempts: number;
  summaryProvider: z.infer<typeof environmentSchema>["SUMMARY_PROVIDER"];
  summaryRetryBaseMs: number;
  summaryRetryMaxMs: number;
  summaryTimeZone: string;
  summaryTimeoutMs: number;
  storageMode: z.infer<typeof environmentSchema>["STORAGE_MODE"];
  transcriptionConcurrency: number;
  transcriptionLanguage: string;
  transcriptionMergeMaxGapMs: number;
  transcriptionModelProfilesFile: string;
  transcriptionProvider: z.infer<typeof environmentSchema>["TRANSCRIPTION_PROVIDER"];
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
    botLanguage: parsed.BOT_LANGUAGE,
    dataDir: parsed.DATA_DIR,
    ...(parsed.DATABASE_URL === undefined ? {} : { databaseUrl: parsed.DATABASE_URL }),
    discordClientId: parsed.DISCORD_CLIENT_ID,
    ...(parsed.DISCORD_GUILD_ID === undefined ? {} : { discordGuildId: parsed.DISCORD_GUILD_ID }),
    discordToken: parsed.DISCORD_TOKEN,
    fasterWhisperModel: parsed.FASTER_WHISPER_MODEL,
    logLevel: parsed.LOG_LEVEL,
    ollamaRefinementModel: parsed.OLLAMA_REFINEMENT_MODEL,
    ollamaSummaryModel: parsed.OLLAMA_SUMMARY_MODEL,
    ...(parsed.OPENROUTER_API_KEY === undefined
      ? {}
      : { openRouterApiKey: parsed.OPENROUTER_API_KEY }),
    ...(parsed.OPENROUTER_REFINEMENT_MODEL === undefined
      ? {}
      : { openRouterRefinementModel: parsed.OPENROUTER_REFINEMENT_MODEL }),
    ...(parsed.OPENROUTER_SUMMARY_MODEL === undefined
      ? {}
      : { openRouterSummaryModel: parsed.OPENROUTER_SUMMARY_MODEL }),
    ...(parsed.OPENROUTER_TRANSCRIPTION_MODEL === undefined
      ? {}
      : { openRouterTranscriptionModel: parsed.OPENROUTER_TRANSCRIPTION_MODEL }),
    persistMeetingContent: parsed.PERSIST_MEETING_CONTENT,
    persistMeetingAudio: parsed.PERSIST_MEETING_AUDIO,
    segmentMaxSeconds: parsed.SEGMENT_MAX_SECONDS,
    segmentSilenceMs: parsed.SEGMENT_SILENCE_MS,
    refinementChunkMaxCharacters: parsed.REFINEMENT_CHUNK_MAX_CHARACTERS,
    refinementMaxAttempts: parsed.REFINEMENT_MAX_ATTEMPTS,
    refinementProvider: parsed.REFINEMENT_PROVIDER,
    refinementRetryBaseMs: parsed.REFINEMENT_RETRY_BASE_MS,
    refinementRetryMaxMs: parsed.REFINEMENT_RETRY_MAX_MS,
    refinementTimeoutMs: parsed.REFINEMENT_TIMEOUT_MS,
    summaryChunkMaxCharacters: parsed.SUMMARY_CHUNK_MAX_CHARACTERS,
    summaryLanguage: parsed.SUMMARY_LANGUAGE,
    summaryMaxAttempts: parsed.SUMMARY_MAX_ATTEMPTS,
    summaryProvider: parsed.SUMMARY_PROVIDER,
    summaryRetryBaseMs: parsed.SUMMARY_RETRY_BASE_MS,
    summaryRetryMaxMs: parsed.SUMMARY_RETRY_MAX_MS,
    summaryTimeZone: parsed.SUMMARY_TIME_ZONE,
    summaryTimeoutMs: parsed.SUMMARY_TIMEOUT_MS,
    storageMode: parsed.STORAGE_MODE,
    transcriptionConcurrency: parsed.TRANSCRIPTION_CONCURRENCY,
    transcriptionLanguage: parsed.TRANSCRIPTION_LANGUAGE,
    transcriptionMergeMaxGapMs: parsed.TRANSCRIPTION_MERGE_MAX_GAP_MS,
    transcriptionModelProfilesFile: parsed.TRANSCRIPTION_MODEL_PROFILES_FILE,
    transcriptionProvider: parsed.TRANSCRIPTION_PROVIDER,
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

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function isSupportedLanguageSetting(language: string): boolean {
  return language === "auto" || /^[a-z]{2,3}(?:-[A-Za-z]{2}|-[0-9]{3})?$/.test(language);
}
