import { z } from "zod";

const environmentSchema = z.object({
  DATA_DIR: z.string().min(1).default("./data"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID é obrigatório"),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN é obrigatório"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
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
  logLevel: z.infer<typeof environmentSchema>["LOG_LEVEL"];
  segmentMaxSeconds: number;
  segmentSilenceMs: number;
  voiceReconnectMaxMs: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    dataDir: parsed.DATA_DIR,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    ...(parsed.DISCORD_GUILD_ID === undefined ? {} : { discordGuildId: parsed.DISCORD_GUILD_ID }),
    discordToken: parsed.DISCORD_TOKEN,
    logLevel: parsed.LOG_LEVEL,
    segmentMaxSeconds: parsed.SEGMENT_MAX_SECONDS,
    segmentSilenceMs: parsed.SEGMENT_SILENCE_MS,
    voiceReconnectMaxMs: parsed.VOICE_RECONNECT_MAX_MS,
  };
}
