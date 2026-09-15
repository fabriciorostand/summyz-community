import { describe, expect, it } from "vitest";

import {
  formatCost,
  formatDate,
  formatDeadline,
  formatDuration,
  formatElapsed,
  formatInteger,
  formatRoundedCost,
  formatShortDate,
  initialsOf,
  percentageOf,
  pipelineStatus,
} from "./format";

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

describe("formatCost", () => {
  it("joins every confirmed currency", () => {
    expect(
      formatCost([
        { amount: "12.4812", currency: "USD" },
        { amount: "3.5", currency: "BRL" },
      ]),
    ).toBe("USD 12,4812 · BRL 3,5");
  });

  it("renders a dash when nothing was confirmed", () => {
    expect(formatCost([])).toBe("—");
  });

  it("keeps the full precision of micro amounts", () => {
    expect(formatCost([{ amount: "0.412907", currency: "USD" }])).toBe("USD 0,412907");
  });

  it("falls back to the raw amount when it is not a number", () => {
    expect(formatCost([{ amount: "n/a", currency: "USD" }])).toBe("USD n/a");
  });
});

describe("formatRoundedCost", () => {
  it("always shows two decimals", () => {
    expect(
      formatRoundedCost([
        { amount: "3.5", currency: "USD" },
        { amount: "12.4812", currency: "BRL" },
      ]),
    ).toBe("USD 3,50 · BRL 12,48");
  });

  it("flags positive amounts that would round down to zero", () => {
    expect(formatRoundedCost([{ amount: "0.004", currency: "USD" }])).toBe("< USD 0,01");
  });

  it("keeps an exact zero as zero", () => {
    expect(formatRoundedCost([{ amount: "0", currency: "USD" }])).toBe("USD 0,00");
  });

  it("rounds amounts at the half-cent boundary up", () => {
    expect(formatRoundedCost([{ amount: "0.005", currency: "USD" }])).toBe("USD 0,01");
  });

  it("renders a dash when nothing was confirmed", () => {
    expect(formatRoundedCost([])).toBe("—");
  });

  it("falls back to the raw amount when it is not a number", () => {
    expect(formatRoundedCost([{ amount: "n/a", currency: "USD" }])).toBe("USD n/a");
  });
});

describe("formatDate", () => {
  it("formats an instant in the requested time zone", () => {
    expect(formatDate("2026-09-04T17:02:00.000Z", "America/Sao_Paulo")).toBe("04/09 14:02");
  });

  it("returns a dash for a missing instant", () => {
    expect(formatDate(null, "America/Sao_Paulo")).toBe("—");
  });
});

describe("formatShortDate", () => {
  it("formats a bucket start without the time", () => {
    expect(formatShortDate("2026-09-04", "America/Sao_Paulo")).toBe("04/09");
  });
});

describe("formatDeadline", () => {
  it("renders a weekday and date for a date-precision deadline", () => {
    expect(
      formatDeadline(
        { deadlineDate: "2026-09-04", deadlinePrecision: "date", deadlineTime: null },
        "America/Sao_Paulo",
      ),
    ).toBe("SEX 04/09");
  });

  it("includes the time for a minute-precision deadline", () => {
    expect(
      formatDeadline(
        { deadlineDate: "2026-09-04", deadlinePrecision: "minute", deadlineTime: "14:30:00" },
        "America/Sao_Paulo",
      ),
    ).toBe("SEX 04/09 14:30");
  });

  it("says there is no deadline when the date is missing", () => {
    expect(
      formatDeadline({ deadlineDate: null, deadlinePrecision: null, deadlineTime: null }, "UTC"),
    ).toBe("sem prazo");
  });
});

describe("pipelineStatus", () => {
  it("maps the completed status", () => {
    expect(pipelineStatus("completed")).toEqual({ label: "Concluída", tone: "ok" });
  });

  it("maps the failed status", () => {
    expect(pipelineStatus("failed")).toEqual({ label: "Falhou", tone: "fail" });
  });

  it("treats anything else as in progress", () => {
    expect(pipelineStatus("running")).toEqual({ label: "Em andamento", tone: "live" });
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

describe("formatInteger", () => {
  it("groups thousands using the pt-BR locale", () => {
    expect(formatInteger(1204)).toBe("1.204");
  });

  it("renders decimals with a single fraction digit when asked", () => {
    expect(formatInteger(38.34, 1)).toBe("38,3");
  });
});
