import type { AiProfile, ProfileLanguage } from "../ai-profile.js";

type ProfileFields = Pick<
  AiProfile["transcription"],
  "interSpeechSilenceMs" | "providerOptions" | "temperature"
> & { prompt?: string };

export type TranscriptionModelProfile = ProfileFields & {
  language?: ProfileLanguage;
  mergeMaxGapMs?: AiProfile["transcription"]["mergeMaxGapMs"];
};
