import { describe, expect, it } from "vitest";
import {
  exportPresentationSchema,
  formatExportDate,
  timeZoneSchema,
} from "../src/api/date-presentation.js";

describe("request date presentation", () => {
  it.each([
    ["DD/MM/YYYY", "24h", "28/09/2026 23:30"],
    ["MM/DD/YYYY", "12h", "09/28/2026 11:30 PM"],
    ["YYYY-MM-DD", "24h", "2026-09-28 23:30"],
  ] as const)("formats %s with %s in the requested zone", (dateFormat, timeFormat, expected) => {
    expect(
      formatExportDate("2026-09-29T02:30:00.000Z", {
        dateFormat,
        timeFormat,
        timeZone: "America/Sao_Paulo",
      }),
    ).toBe(expected);
  });
  it.each([
    ["00:00", "12:00 AM"],
    ["12:00", "12:00 PM"],
  ])("handles %s", (time, expected) => {
    expect(
      formatExportDate(`2026-09-28T${time}:00.000Z`, {
        dateFormat: "YYYY-MM-DD",
        timeFormat: "12h",
        timeZone: "UTC",
      }),
    ).toBe(`2026-09-28 ${expected}`);
  });
  it("uses regional daylight saving rules", () => {
    const options = {
      dateFormat: "YYYY-MM-DD",
      timeFormat: "24h",
      timeZone: "Europe/Lisbon",
    } as const;
    expect(formatExportDate("2026-01-01T12:00:00.000Z", options)).toBe("2026-01-01 12:00");
    expect(formatExportDate("2026-07-01T12:00:00.000Z", options)).toBe("2026-07-01 13:00");
  });
  it.each([undefined, "", "Mars/Olympus", "+03:00", "UTC; SELECT 1", "EST"])(
    "rejects invalid or ambiguous zone %s",
    (zone) => {
      expect(timeZoneSchema.safeParse(zone).success).toBe(false);
    },
  );
  it("requires every presentation parameter and rejects arbitrary masks", () => {
    const options = { dateFormat: "DD/MM/YYYY", timeFormat: "24h", timeZone: "UTC" };
    for (const field of Object.keys(options)) {
      expect(
        exportPresentationSchema.safeParse(
          Object.fromEntries(Object.entries(options).filter(([key]) => key !== field)),
        ).success,
      ).toBe(false);
    }
    expect(exportPresentationSchema.safeParse({ ...options, dateFormat: "%x" }).success).toBe(
      false,
    );
    expect(exportPresentationSchema.safeParse({ ...options, timeFormat: "auto" }).success).toBe(
      false,
    );
    expect(() => formatExportDate("invalid", exportPresentationSchema.parse(options))).toThrow();
  });
});
