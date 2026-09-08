export interface TranscriptTurn {
  speaker: string;
  startedAt: string;
  text: string;
}

/**
 * The pipeline stores the transcript as one line per turn, shaped as
 * `[hh:mm:ss – hh:mm:ss] Speaker: text` (see assembleTranscriptFromEntries).
 * Lines that do not carry a header belong to the turn that opened above them.
 */
const turnPattern = /^\[(\d{2}:\d{2}:\d{2})\s*[–-]\s*\d{2}:\d{2}:\d{2}\]\s*([^:]+):\s?(.*)$/u;

export function parseTranscript(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of transcript.split("\n")) {
    const match = turnPattern.exec(line);
    if (match === null) {
      const previous = turns.at(-1);
      if (previous !== undefined && line.trim().length > 0) {
        previous.text = `${previous.text}\n${line.trim()}`;
      }
      continue;
    }
    turns.push({
      speaker: (match[2] ?? "").trim(),
      startedAt: match[1] ?? "",
      text: (match[3] ?? "").trim(),
    });
  }
  return turns;
}

export function transcriptStats(turns: readonly TranscriptTurn[]): {
  turns: number;
  words: number;
} {
  const words = turns.reduce(
    (total, turn) => total + turn.text.split(/\s+/u).filter((word) => word.length > 0).length,
    0,
  );
  return { turns: turns.length, words };
}
