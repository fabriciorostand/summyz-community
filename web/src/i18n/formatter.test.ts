import { describe, expect, it } from "vitest";

import { createFormatter } from "./formatter";

const brazil = createFormatter({ dateFormat: "DD/MM/YYYY", language: "pt-BR", timeFormat: "24h" });
const us = createFormatter({ dateFormat: "MM/DD/YYYY", language: "en", timeFormat: "12h" });
const iso = createFormatter({ dateFormat: "YYYY-MM-DD", language: "en", timeFormat: "24h" });
const zone = "America/Sao_Paulo";
const lateEvening = "2027-01-01T02:30:00.000Z"; // 31/12/2026 23:30 in São Paulo

describe("instants", () => {
  it("renders the full date and time in the chosen formats and time zone", () => {
    expect(brazil.dateTime(lateEvening, zone)).toBe("31/12/2026 23:30");
    expect(us.dateTime(lateEvening, zone)).toBe("12/31/2026 11:30 PM");
    expect(iso.dateTime(lateEvening, zone)).toBe("2026-12-31 23:30");
  });

  it("drops the year where lists keep it short", () => {
    expect(brazil.shortDateTime(lateEvening, zone)).toBe("31/12 23:30");
    expect(us.shortDateTime(lateEvening, zone)).toBe("12/31 11:30 PM");
    expect(iso.shortDateTime(lateEvening, zone)).toBe("12-31 23:30");
  });

  it("renders the time alone without cutting the day period", () => {
    expect(brazil.time(lateEvening, zone)).toBe("23:30");
    expect(us.time(lateEvening, zone)).toBe("11:30 PM");
  });

  it("writes midnight and noon the 12-hour way", () => {
    expect(us.time("2026-09-04T03:05:00.000Z", zone)).toBe("12:05 AM");
    expect(us.time("2026-09-04T15:00:00.000Z", zone)).toBe("12:00 PM");
    expect(brazil.time("2026-09-04T03:05:00.000Z", zone)).toBe("00:05");
  });

  it("returns a dash for a missing instant", () => {
    expect(brazil.dateTime(null, zone)).toBe("—");
    expect(brazil.shortDateTime(null, zone)).toBe("—");
  });
});

describe("calendar dates", () => {
  it("renders a day and month in the chosen order", () => {
    expect(brazil.dayMonth("2026-09-04")).toBe("04/09");
    expect(us.dayMonth("2026-09-04")).toBe("09/04");
    expect(iso.dayMonth("2026-09-04")).toBe("09-04");
  });
});

describe("deadlines", () => {
  const onFriday = {
    deadlineDate: "2026-09-04",
    deadlinePrecision: "date" as const,
    deadlineTime: null,
  };

  it("renders a weekday in the dashboard language and the date", () => {
    expect(brazil.deadline(onFriday)).toBe("SEX 04/09");
    expect(us.deadline(onFriday)).toBe("FRI 09/04");
  });

  it("adds the time in the chosen clock when the deadline has minute precision", () => {
    const withTime = {
      ...onFriday,
      deadlinePrecision: "minute" as const,
      deadlineTime: "14:30:00",
    };
    expect(brazil.deadline(withTime)).toBe("SEX 04/09 14:30");
    expect(us.deadline(withTime)).toBe("FRI 09/04 2:30 PM");
  });

  it("ignores a time that only comes with date precision", () => {
    expect(brazil.deadline({ ...onFriday, deadlineTime: "14:30" })).toBe("SEX 04/09");
  });

  it("reports that there is no deadline", () => {
    expect(brazil.deadline({ ...onFriday, deadlineDate: null })).toBeNull();
  });
});

describe("numbers", () => {
  it("uses the separators of the dashboard language", () => {
    expect(brazil.number(1_234.5, 1)).toBe("1.234,5");
    expect(us.number(1_234.5, 1)).toBe("1,234.5");
    expect(brazil.number(42)).toBe("42");
  });

  it("keeps decimals only when they exist", () => {
    expect(brazil.decimal(0.15)).toBe("0,15");
    expect(us.decimal(0.5)).toBe("0.5");
  });

  it("renders sizes in MB and GB", () => {
    expect(brazil.bytes(1_500_000_000)).toBe("1,5 GB");
    expect(us.bytes(1_500_000_000)).toBe("1.5 GB");
    expect(us.bytes(245_000_000)).toBe("245 MB");
    expect(us.bytes(150_000_000_000)).toBe("150 GB");
  });

  it("joins items the way the dashboard language does", () => {
    expect(brazil.list(["a", "b", "c"])).toBe("a, b e c");
    expect(us.list(["a", "b", "c"])).toBe("a, b, and c");
  });

  it("names a language in the dashboard language", () => {
    expect(brazil.languageName("de")).toBe("Alemão");
    expect(us.languageName("de")).toBe("German");
  });
});

describe("costs", () => {
  it("keeps the currency code first and only changes the separators", () => {
    const entries = [
      { amount: "12.4812", currency: "USD" },
      { amount: "3.5", currency: "BRL" },
    ];
    expect(brazil.cost(entries)).toBe("USD 12,4812 · BRL 3,5");
    expect(us.cost(entries)).toBe("USD 12.4812 · BRL 3.5");
  });

  it("keeps the full precision of micro amounts", () => {
    expect(us.cost([{ amount: "0.412907", currency: "USD" }])).toBe("USD 0.412907");
  });

  it("renders two decimals on the rounded variant", () => {
    expect(brazil.roundedCost([{ amount: "3.5", currency: "USD" }])).toBe("USD 3,50");
    expect(us.roundedCost([{ amount: "3.5", currency: "USD" }])).toBe("USD 3.50");
  });

  it("flags positive amounts that would round down to zero", () => {
    expect(brazil.roundedCost([{ amount: "0.004", currency: "USD" }])).toBe("< USD 0,01");
    expect(us.roundedCost([{ amount: "0.004", currency: "USD" }])).toBe("< USD 0.01");
  });

  it("keeps an exact zero and the half-cent boundary as they round", () => {
    expect(us.roundedCost([{ amount: "0", currency: "USD" }])).toBe("USD 0.00");
    expect(us.roundedCost([{ amount: "0.005", currency: "USD" }])).toBe("USD 0.01");
  });

  it("renders a dash when nothing was confirmed and raw text when it is not a number", () => {
    expect(us.cost([])).toBe("—");
    expect(us.roundedCost([])).toBe("—");
    expect(us.cost([{ amount: "n/a", currency: "USD" }])).toBe("USD n/a");
    expect(us.roundedCost([{ amount: "n/a", currency: "USD" }])).toBe("USD n/a");
  });
});
