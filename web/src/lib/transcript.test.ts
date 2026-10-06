import { describe, expect, it } from "vitest";

import { parseTranscript } from "./transcript";

/** The pipeline writes millisecond timestamps (see assembleTranscriptFromEntries). */
const sample = [
  "[00:00:04.120 – 00:00:19.870] PixelPaladin: Build está verde na main.",
  "[00:00:19.870 – 00:00:41.005] RespawnRita: O co-op dessincroniza no nível 3.",
].join("\n");

describe("parseTranscript", () => {
  it("splits the stored transcript into speaker turns", () => {
    expect(parseTranscript(sample)).toEqual([
      {
        speaker: "PixelPaladin",
        startedAt: "00:00:04",
        text: "Build está verde na main.",
      },
      {
        speaker: "RespawnRita",
        startedAt: "00:00:19",
        text: "O co-op dessincroniza no nível 3.",
      },
    ]);
  });

  it("shows the start time without milliseconds", () => {
    const turns = parseTranscript("[01:02:03.999 – 01:02:04.000] Ana: Fechado.");
    expect(turns[0]?.startedAt).toBe("01:02:03");
  });

  it("still reads timestamps written without milliseconds", () => {
    const turns = parseTranscript("[00:00:04 – 00:00:19] Ana: Fechado.");
    expect(turns).toEqual([{ speaker: "Ana", startedAt: "00:00:04", text: "Fechado." }]);
  });

  it("accepts a plain hyphen between the timestamps", () => {
    const turns = parseTranscript("[00:01:00 - 00:01:05] Ana: Fechado.");
    expect(turns).toEqual([{ speaker: "Ana", startedAt: "00:01:00", text: "Fechado." }]);
  });

  it("keeps colons that belong to the spoken text", () => {
    const turns = parseTranscript("[00:00:01 – 00:00:02] Ana: Link: exemplo.com");
    expect(turns[0]?.text).toBe("Link: exemplo.com");
  });

  it("appends continuation lines to the previous turn", () => {
    const turns = parseTranscript("[00:00:01 – 00:00:09] Ana: Primeira linha.\nSegunda linha.");
    expect(turns).toEqual([
      { speaker: "Ana", startedAt: "00:00:01", text: "Primeira linha.\nSegunda linha." },
    ]);
  });

  it("returns no turns for an empty transcript", () => {
    expect(parseTranscript("")).toEqual([]);
  });

  it("returns no turns when no line matches the expected shape", () => {
    expect(parseTranscript("texto solto sem cabeçalho")).toEqual([]);
  });
});
