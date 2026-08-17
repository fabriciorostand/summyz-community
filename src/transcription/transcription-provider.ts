export type TranscriptionAudioFormat = "ogg" | "wav";

export interface TranscriptPiece {
  endedAtMs: number;
  startedAtMs: number;
  text: string;
}

export interface TranscriptionProviderResult {
  attempts: number;
  pieces: TranscriptPiece[];
}

export interface TranscriptionProvider {
  transcribe(input: {
    audio: Uint8Array;
    audioDurationMs?: number;
    format: TranscriptionAudioFormat;
  }): Promise<TranscriptionProviderResult>;
}

export interface TranscribedSegment {
  audioDurationMs?: number;
  pieces: TranscriptPiece[];
  segmentId: string;
  timelineStartedAtMs?: number;
}
