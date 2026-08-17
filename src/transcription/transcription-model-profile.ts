import { readFile } from "node:fs/promises";

import { z } from "zod";

const providerOptionsSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.json()));

const transcriptionModelProfileSchema = z.object({
  interSpeechSilenceMs: z.number().int().min(0).max(5_000),
  language: z.string().min(1).optional(),
  providerOptions: providerOptionsSchema.optional(),
  temperature: z.number().min(0).max(1),
  timestampMode: z.enum(["batch", "word"]),
});

const transcriptionModelProfilesSchema = z.record(
  z.string().min(1),
  transcriptionModelProfileSchema,
);

export type TranscriptionModelProfile = z.infer<typeof transcriptionModelProfileSchema>;
export type TranscriptionModelProfiles = z.infer<typeof transcriptionModelProfilesSchema>;

export function parseTranscriptionModelProfiles(input: unknown): TranscriptionModelProfiles {
  return transcriptionModelProfilesSchema.parse(input);
}

export async function loadTranscriptionModelProfile(
  path: string,
  model: string,
): Promise<TranscriptionModelProfile> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Não foi possível ler os perfis de modelos de transcrição");
  }

  let profiles: TranscriptionModelProfiles;
  try {
    profiles = parseTranscriptionModelProfiles(input);
  } catch {
    throw new Error("O arquivo de perfis de modelos de transcrição é inválido");
  }
  const profile = profiles[model];
  if (profile === undefined) {
    throw new Error("O modelo configurado não possui perfil de transcrição");
  }
  return profile;
}
