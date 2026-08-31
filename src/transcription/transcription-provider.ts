export type TranscriptionAudioFormat = "ogg" | "wav";

export interface TranscriptPiece {
  endedAtMs: number;
  startedAtMs: number;
  text: string;
}

export interface TranscriptionProviderResult {
  attempts: number;
  pieces: TranscriptPiece[];
  words?: TranscriptPiece[];
}

export interface TranscriptionProvider {
  transcribe(input: {
    audio: Uint8Array;
    audioDurationMs?: number;
    format: TranscriptionAudioFormat;
    language?: string;
  }): Promise<TranscriptionProviderResult>;
}

export type TranscriptionIncompatibilityReason =
  | "invalid_audio_duration"
  | "invalid_json"
  | "invalid_response_shape"
  | "invalid_timestamps"
  | "missing_timestamps";

export class TranscriptionRequestError extends Error {
  public readonly retryAfterMs: number | undefined;
  public readonly retryable: boolean;
  public readonly status: number | undefined;

  public constructor(input: { retryAfterMs?: number; retryable: boolean; status?: number }) {
    super(
      input.status === undefined
        ? "The transcription request failed"
        : `The transcription request failed with status ${String(input.status)}`,
    );
    this.name = "TranscriptionRequestError";
    this.retryAfterMs = input.retryAfterMs;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}

export class IncompatibleTranscriptionResponseError extends Error {
  public readonly reason: TranscriptionIncompatibilityReason;

  public constructor(reason: TranscriptionIncompatibilityReason) {
    super("The configured model returned incompatible timestamps");
    this.name = "IncompatibleTranscriptionResponseError";
    this.reason = reason;
  }
}

export interface TranscribedSegment {
  audioDurationMs?: number;
  pieces: TranscriptPiece[];
  words?: TranscriptPiece[];
  segmentId: string;
  timelineStartedAtMs?: number;
}
