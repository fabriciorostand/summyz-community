import { describe, expect, it } from "vitest";

import { en } from "../i18n/messages/en";
import { ptBR } from "../i18n/messages/pt-BR";
import { formatDuration, formatElapsed, initialsOf, percentageOf, pipelineStatus } from "./format";

describe("formatDuration", () => {
  it("renders seconds below a minute", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });

  it("renders minutes below an hour", () => {
    expect(formatDuration(12 * 60_000)).toBe("12m");
  });

  it("pads minutes once hours are present", () => {
    expect(formatDuration(64 * 60_000)).toBe("1h 04m");
  });

  it("treats a missing duration as a dash", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatElapsed", () => {
  it("renders a clock for the live meeting card", () => {
    expect(formatElapsed(12 * 60_000 + 41_000)).toBe("12:41");
  });

  it("includes hours once they are reached", () => {
    expect(formatElapsed(3 * 3_600_000 + 4 * 60_000 + 9_000)).toBe("3:04:09");
  });

  it("clamps negative drift to zero", () => {
    expect(formatElapsed(-5_000)).toBe("00:00");
  });
});

describe("pipelineStatus", () => {
  it("maps the completed status", () => {
    expect(pipelineStatus("completed", ptBR.pipeline)).toEqual({ label: "Concluída", tone: "ok" });
  });

  it("maps the failed status", () => {
    expect(pipelineStatus("failed", ptBR.pipeline)).toEqual({ label: "Falhou", tone: "fail" });
  });

  it("treats anything else as in progress", () => {
    expect(pipelineStatus("running", ptBR.pipeline)).toEqual({
      label: "Em andamento",
      tone: "live",
    });
  });

  it("labels the status in the dashboard language", () => {
    expect(pipelineStatus("completed", en.pipeline).label).toBe("Completed");
  });
});

describe("percentageOf", () => {
  it("scales a value against the largest entry", () => {
    expect(percentageOf(50, 200)).toBe(25);
  });

  it("returns zero when the maximum is zero", () => {
    expect(percentageOf(10, 0)).toBe(0);
  });
});

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Marcela Torres")).toBe("MT");
  });

  it("takes the first two letters of a single word", () => {
    expect(initialsOf("PixelPaladin")).toBe("PI");
  });

  it("falls back to a placeholder for blank names", () => {
    expect(initialsOf("   ")).toBe("?");
  });
});
