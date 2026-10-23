import type { AiProfile, ProfileLanguage } from "summyz-community-shared/ai-profile";

type ProfileFields = Pick<
  AiProfile["transcription"],
  "interSpeechSilenceMs" | "providerOptions" | "temperature"
> & { prompt?: string };

export type TranscriptionModelProfile = ProfileFields & {
  language?: ProfileLanguage;
  mergeMaxGapMs?: AiProfile["transcription"]["mergeMaxGapMs"];
};
