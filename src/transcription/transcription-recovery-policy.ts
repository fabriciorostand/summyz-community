import { z } from "zod";

export const CURRENT_TRANSCRIPTION_RECOVERY_VERSION = 1;
export const TRANSCRIPTION_FAILURE_RETENTION_MS = 24 * 60 * 60 * 1_000;

export const transcriptionRecoveryReasonSchema = z.enum([
  "invalid_json",
  "invalid_response_shape",
  "invalid_timestamps",
  "missing_language",
  "missing_timestamps",
]);
export type TranscriptionRecoveryReason = z.infer<typeof transcriptionRecoveryReasonSchema>;
