export interface TranscriptTurn {
  speaker: string;
  startedAt: string;
  text: string;
}

/**
 * The pipeline stores the transcript as one line per turn, shaped as
 * `[hh:mm:ss.mmm – hh:mm:ss.mmm] Speaker: text` (see assembleTranscriptFromEntries).
 * The start time is kept to the second; milliseconds are optional.
 * Lines that do not carry a header belong to the turn that opened above them.
 */
const turnPattern =
  /^\[(\d{2}:\d{2}:\d{2})(?:\.\d{3})?\s*[–-]\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]\s*([^:]+):\s?(.*)$/u;

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
