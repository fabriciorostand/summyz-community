import type { RecordingManifest, RecordingSegment } from "../recording/manifest.js";
import type { TranscribedSegment } from "./transcription-provider.js";

export interface TranscriptEntry {
  endedAtMs: number;
  id: string;
  speaker: string;
  startedAtMs: number;
  text: string;
}

export function assembleTranscript(
  manifest: RecordingManifest,
  transcriptions: readonly TranscribedSegment[],
): string {
  const entries = assembleTranscriptEntries(manifest, transcriptions);
  const lines = entries.map(
    (entry) =>
      `[${formatTimestamp(entry.startedAtMs)} – ${formatTimestamp(entry.endedAtMs)}] ` +
      `${entry.speaker}: ${entry.text}`,
  );
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

export function assembleTranscriptEntries(
  manifest: RecordingManifest,
  transcriptions: readonly TranscribedSegment[],
): TranscriptEntry[] {
  const transcriptionBySegmentId = new Map(
    transcriptions.map((transcription) => [transcription.segmentId, transcription]),
  );
  if (
    transcriptionBySegmentId.size !== transcriptions.length ||
    manifest.segments.length !== transcriptions.length
  ) {
    throw new Error("A transcrição deve conter resultados para todos os segmentos");
  }

  const speakerNames = createSpeakerNames(manifest.segments);
  const pieces: TranscriptEntry[] = [];
  for (const segment of manifest.segments) {
    const transcription = transcriptionBySegmentId.get(segment.segmentId);
    if (transcription === undefined) {
      throw new Error("A transcrição deve conter resultados para todos os segmentos");
    }
    if (
      (transcription.audioDurationMs === undefined) !==
      (transcription.timelineStartedAtMs === undefined)
    ) {
      throw new Error("A origem temporal do lote está incompleta");
    }
    const timelineStartedAtMs = transcription.timelineStartedAtMs ?? segment.startedAtMs;
    const audioDurationMs = transcription.audioDurationMs ?? segment.durationMs;
    for (const [index, piece] of transcription.pieces.entries()) {
      const text = piece.text.trim();
      if (
        text.length === 0 ||
        piece.startedAtMs < 0 ||
        piece.endedAtMs <= piece.startedAtMs ||
        piece.endedAtMs > audioDurationMs
      ) {
        throw new Error("A transcrição retornou um timestamp inválido para o segmento");
      }
      pieces.push({
        endedAtMs: timelineStartedAtMs + piece.endedAtMs,
        id: `${segment.segmentId}:${String(index).padStart(6, "0")}`,
        speaker: speakerNames.get(segment.userId) ?? segment.userDisplayName,
        startedAtMs: timelineStartedAtMs + piece.startedAtMs,
        text,
      });
    }
  }

  pieces.sort(
    (left, right) =>
      left.startedAtMs - right.startedAtMs ||
      left.endedAtMs - right.endedAtMs ||
      left.id.localeCompare(right.id),
  );
  return pieces;
}

function createSpeakerNames(segments: readonly RecordingSegment[]): Map<string, string> {
  const firstSegmentByUserId = new Map<string, RecordingSegment>();
  for (const segment of segments) {
    const previous = firstSegmentByUserId.get(segment.userId);
    if (
      previous === undefined ||
      segment.startedAtMs < previous.startedAtMs ||
      (segment.startedAtMs === previous.startedAtMs && segment.segmentId < previous.segmentId)
    ) {
      firstSegmentByUserId.set(segment.userId, segment);
    }
  }

  const usersByDisplayName = new Map<string, RecordingSegment[]>();
  for (const segment of firstSegmentByUserId.values()) {
    const users = usersByDisplayName.get(segment.userDisplayName) ?? [];
    users.push(segment);
    usersByDisplayName.set(segment.userDisplayName, users);
  }

  const names = new Map<string, string>();
  for (const [displayName, users] of usersByDisplayName) {
    users.sort(
      (left, right) =>
        left.startedAtMs - right.startedAtMs || left.userId.localeCompare(right.userId),
    );
    for (const [index, user] of users.entries()) {
      names.set(user.userId, users.length === 1 ? displayName : `${displayName} #${index + 1}`);
    }
  }
  return names;
}

function formatTimestamp(milliseconds: number): string {
  const rounded = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(rounded / 3_600_000);
  const minutes = Math.floor((rounded % 3_600_000) / 60_000);
  const seconds = Math.floor((rounded % 60_000) / 1_000);
  const remainder = rounded % 1_000;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
    .concat(`.${String(remainder).padStart(3, "0")}`);
}
