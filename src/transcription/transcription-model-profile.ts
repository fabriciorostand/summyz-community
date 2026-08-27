import type { AiProfile } from "../ai-profile.js";

type ProfileFields = Pick<
  AiProfile["transcription"],
  "interSpeechSilenceMs" | "prompt" | "providerOptions" | "temperature" | "timestampMode"
>;

export type TranscriptionModelProfile = ProfileFields & {
  language?: AiProfile["transcription"]["language"];
  mergeMaxGapMs?: AiProfile["transcription"]["mergeMaxGapMs"];
};
