/** Tailwind fills for the chart series tokens, in their validated order. */
const seriesFills = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4"] as const;

/** Series past the fourth share one neutral fill; the palette never cycles. */
export function seriesColor(index: number): string {
  return seriesFills[index] ?? "bg-series-other";
}

/** Each stage keeps its own colour on every screen, whatever the others cost. */
const stageFills = {
  refinement: seriesColor(1),
  summary: seriesColor(2),
  transcription: seriesColor(0),
} as const;

export function stageColor(phase: keyof typeof stageFills): string {
  return stageFills[phase];
}
