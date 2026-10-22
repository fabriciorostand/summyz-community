export function normalizeTranscriptForBenchmark(transcript: string): string {
  return transcript
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\[[^\]]+\]\s+[^:]+:\s*/u, ""))
    .join(" ")
    .normalize("NFC")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function calculateErrorRate<T>(reference: readonly T[], hypothesis: readonly T[]): number {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index);
  for (const [referenceIndex, referenceItem] of reference.entries()) {
    const current = [referenceIndex + 1];
    for (const [hypothesisIndex, hypothesisItem] of hypothesis.entries()) {
      const deletion = (previous[hypothesisIndex + 1] ?? 0) + 1;
      const insertion = (current[hypothesisIndex] ?? 0) + 1;
      const substitution =
        (previous[hypothesisIndex] ?? 0) + (referenceItem === hypothesisItem ? 0 : 1);
      current.push(Math.min(deletion, insertion, substitution));
    }
    previous = current;
  }
  return (previous[hypothesis.length] ?? reference.length) / reference.length;
}

export function calculateTranscriptMetrics(
  referenceTranscript: string,
  hypothesisTranscript: string,
): { characterErrorRate: number; wordErrorRate: number } {
  const reference = normalizeTranscriptForBenchmark(referenceTranscript);
  const hypothesis = normalizeTranscriptForBenchmark(hypothesisTranscript);
  return {
    characterErrorRate: calculateErrorRate([...reference], [...hypothesis]),
    wordErrorRate: calculateErrorRate(
      reference.length === 0 ? [] : reference.split(" "),
      hypothesis.length === 0 ? [] : hypothesis.split(" "),
    ),
  };
}
