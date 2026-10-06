import { describe, expect, it } from "vitest";

import { seriesColor, stageColor } from "./series";

describe("seriesColor", () => {
  it("assigns the four series colours in order", () => {
    expect([0, 1, 2, 3].map(seriesColor)).toEqual([
      "bg-series-1",
      "bg-series-2",
      "bg-series-3",
      "bg-series-4",
    ]);
  });

  it("folds every later or missing position into the neutral series instead of cycling", () => {
    expect(seriesColor(4)).toBe("bg-series-other");
    expect(seriesColor(9)).toBe("bg-series-other");
    expect(seriesColor(-1)).toBe("bg-series-other");
  });
});

describe("stageColor", () => {
  it("gives each pipeline stage its own fixed series colour", () => {
    expect(stageColor("transcription")).toBe("bg-series-1");
    expect(stageColor("refinement")).toBe("bg-series-2");
    expect(stageColor("summary")).toBe("bg-series-3");
  });
});
