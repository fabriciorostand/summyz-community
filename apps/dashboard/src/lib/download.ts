/** Hands the browser a text file built in memory, then releases the object URL. */
export function downloadTextFile(fileName: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.download = fileName;
  anchor.href = url;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}

/**
 * Builds a safe file name from a channel name that comes from Discord.
 * Decomposing to NFD and dropping the combining marks keeps accented names readable
 * once every non-alphanumeric run collapses into a single hyphen.
 */
export function meetingFileName(
  voiceChannelName: string | null,
  meetingId: string,
  fallback: string,
): string {
  const base = (voiceChannelName ?? meetingId)
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .replaceAll(/[^a-zA-Z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .toLowerCase();
  return `${base.length === 0 ? fallback : base}.txt`;
}
