import type { AiProfile } from "../ai-profile.js";

type ProfileFields = Pick<
  AiProfile["transcription"],
  "interSpeechSilenceMs" | "providerOptions" | "temperature"
> & { prompt?: string };

export type TranscriptionModelProfile = ProfileFields & {
  language?: AiProfile["transcription"]["language"];
  mergeMaxGapMs?: AiProfile["transcription"]["mergeMaxGapMs"];
};
