import { describe, expect, it } from "vitest";

import { confirmedAmount, costRange, currentMonthRange } from "./costs";

describe("currentMonthRange", () => {
  it("runs from the first of the month to today in the viewer's zone", () => {
    expect(currentMonthRange(new Date("2026-10-05T15:00:00.000Z"), "America/Sao_Paulo")).toEqual({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-05",
    });
  });

  it("follows the zone across a month boundary", () => {
    const instant = new Date("2026-11-01T01:00:00.000Z");
    expect(currentMonthRange(instant, "America/Sao_Paulo")).toEqual({
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
    });
    expect(currentMonthRange(instant, "Europe/Lisbon")).toEqual({
      dateFrom: "2026-11-01",
      dateTo: "2026-11-01",
    });
  });
});

describe("costRange", () => {
  const fallback = { dateFrom: "2026-10-01", dateTo: "2026-10-05" };

  it("reads both dates from the address", () => {
    expect(costRange(new URLSearchParams("from=2026-09-01&to=2026-09-30"), fallback)).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });
  });

  it.each(["", "from=2026-09-01", "from=2026-02-30&to=2026-03-01", "from=hoje&to=2026-09-30"])(
    "falls back to the current month for %j",
    (search) => {
      expect(costRange(new URLSearchParams(search), fallback)).toEqual(fallback);
    },
  );

  it("keeps a reversed range so the page can explain it", () => {
    expect(costRange(new URLSearchParams("from=2026-09-30&to=2026-09-01"), fallback)).toEqual({
      dateFrom: "2026-09-30",
      dateTo: "2026-09-01",
    });
  });
});

describe("confirmedAmount", () => {
  it("adds the numeric amounts and skips unreadable ones", () => {
    expect(
      confirmedAmount([
        { amount: "0.25", currency: "USD" },
        { amount: "1.5", currency: "USD" },
        { amount: "n/a", currency: "USD" },
      ]),
    ).toBe(1.75);
    expect(confirmedAmount([])).toBe(0);
  });
});
