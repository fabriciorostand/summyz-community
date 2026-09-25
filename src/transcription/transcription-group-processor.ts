import type { Logger } from "pino";

import type { RecordingManifest, RecordingSegment } from "../recording/manifest.js";
import type { PreparedAudio } from "./meeting-audio-preparer.js";
import type { LanguageEvidence } from "./predominant-language.js";
import type { SpeechAnalyzer } from "./speech-analyzer.js";
import {
  type AnalyzedSegment,
  composeTranscriptionBatch,
  createAnalyzedTranscriptionGroups,
  mapTranscriptPiecesToTimeline,
  type TranscriptionBatch,
} from "./transcription-batch.js";
import type { TranscriptionProvider } from "./transcription-provider.js";

export type PersistTranscriptionGroup = (
  group: readonly RecordingSegment[],
  input:
    | {
        batch: TranscriptionBatch;
        result: Awaited<ReturnType<TranscriptionProvider["transcribe"]>>;
      }
    | { batch: undefined; result: { attempts: 0; pieces: [] } },
) => Promise<void>;

export interface TranscriptionGroupContext {
  readonly interSpeechSilenceMs: number;
  readonly languageEvidence: Array<LanguageEvidence & { segmentIds: readonly string[] }>;
  readonly logger: Logger;
  readonly manifest: RecordingManifest;
  readonly persistGroup: PersistTranscriptionGroup;
  readonly preparedBySegmentId: ReadonlyMap<string, PreparedAudio>;
  readonly provider: TranscriptionProvider;
  readonly speechAnalyzer: SpeechAnalyzer;
  readonly transcriptionMergeMaxGapMs: number;
  readonly transcriptionWindowMaxMs: number;
}

export class AudioAnalysisError extends Error {
  public constructor() {
    super("Não foi possível analisar a presença de voz no áudio");
    this.name = "AudioAnalysisError";
  }
}

export async function processTranscriptionGroup(
  group: readonly RecordingSegment[],
  context: TranscriptionGroupContext,
): Promise<void> {
  const analyzed = await analyzeGroup(group, context.preparedBySegmentId, context.speechAnalyzer);
  await discardSilentSegments(analyzed, context);
  await transcribeSpeechGroups(analyzed, context);
}

async function analyzeGroup(
  group: readonly RecordingSegment[],
  preparedBySegmentId: ReadonlyMap<string, PreparedAudio>,
  speechAnalyzer: SpeechAnalyzer,
): Promise<AnalyzedSegment[]> {
  const audioFiles = group.map((segment) => {
    const audio = preparedBySegmentId.get(segment.segmentId);
    if (audio === undefined) throw new Error("O áudio do segmento não foi preparado");
    return audio;
  });
  const analyzed: AnalyzedSegment[] = [];
  for (const audio of audioFiles) {
    try {
      const analysis = await speechAnalyzer.analyze(audio.path);
      analyzed.push({ ...analysis, segment: audio.segment });
    } catch {
      throw new AudioAnalysisError();
    }
  }
  return analyzed;
}

async function discardSilentSegments(
  analyzed: readonly AnalyzedSegment[],
  context: TranscriptionGroupContext,
): Promise<void> {
  const silentSegments = analyzed
    .filter((item) => !item.containsSpeech)
    .map((item) => item.segment);
  if (silentSegments.length === 0) return;
  await context.persistGroup(silentSegments, {
    batch: undefined,
    result: { attempts: 0, pieces: [] },
  });
  context.logger.info(
    { meetingId: context.manifest.meetingId, segmentCount: silentSegments.length },
    "Segments without speech discarded from transcription",
  );
}

async function transcribeSpeechGroups(
  analyzed: readonly AnalyzedSegment[],
  context: TranscriptionGroupContext,
): Promise<void> {
  const speechGroups = createAnalyzedTranscriptionGroups(analyzed, {
    maxGapMs: context.transcriptionMergeMaxGapMs,
    maxWindowMs: context.transcriptionWindowMaxMs,
  });
  for (const speechGroup of speechGroups) {
    const batch = composeTranscriptionBatch(speechGroup, undefined, context.interSpeechSilenceMs);
    if (batch === undefined) throw new AudioAnalysisError();
    const result = await context.provider.transcribe({
      audio: batch.audio,
      audioDurationMs: batch.audioDurationMs,
      format: "wav",
      language: context.manifest.aiConfiguration?.transcription.language ?? "auto",
    });
    collectLanguageEvidence(context.languageEvidence, batch, result);
    await context.persistGroup(
      speechGroup.map((item) => item.segment),
      {
        batch,
        result: {
          ...result,
          pieces: mapTranscriptPiecesToTimeline(batch, result.pieces),
          ...(result.words === undefined
            ? {}
            : { words: mapTranscriptPiecesToTimeline(batch, result.words) }),
        },
      },
    );
    context.logger.info(
      {
        attempts: result.attempts,
        meetingId: context.manifest.meetingId,
        segmentCount: speechGroup.length,
      },
      "Audio batch transcribed",
    );
  }
}

function collectLanguageEvidence(
  evidence: Array<LanguageEvidence & { segmentIds: readonly string[] }>,
  batch: TranscriptionBatch,
  result: Awaited<ReturnType<TranscriptionProvider["transcribe"]>>,
): void {
  if (result.detectedLanguage === undefined) return;
  evidence.push({
    durationMs: batch.audioDurationMs,
    language: result.detectedLanguage.language,
    ...(result.detectedLanguage.probability === undefined
      ? {}
      : { probability: result.detectedLanguage.probability }),
    segmentIds: batch.segmentIds,
  });
}
