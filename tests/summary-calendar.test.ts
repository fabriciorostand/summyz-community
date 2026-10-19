import { describe, expect, it } from "vitest";
import { createSummaryInput } from "../src/summary/summary-input.js";

function entry(id: string, instant?: string, timeZone = "America/Sao_Paulo") {
  return {
    id,
    speaker: "Speaker",
    text: "Future commitment",
    startedAtMs: 0,
    endedAtMs: 1000,
    ...(instant === undefined ? {} : { spokenAt: { instant, timeZone } }),
  };
}

describe("summary calendar context", () => {
  it("does not invent a reference date for historical entries without an instant", () => {
    expect(createSummaryInput([])).toEqual({ transcriptEntries: [] });
    expect(createSummaryInput([entry("legacy")])).toEqual({ transcriptEntries: [entry("legacy")] });
  });

  it("shares a two-week calendar across entries on the same local day", () => {
    const context = createSummaryInput([
      entry("legacy"),
      entry("bruno", "2026-10-18T17:41:46.000Z"),
      entry("carla", "2026-10-18T18:00:00.000Z"),
    ]);
    expect(context.calendarReferences).toHaveLength(1);
    expect(context.calendarReferences?.[0]).toMatchObject({
      referenceDate: "2026-10-18",
      timeZone: "America/Sao_Paulo",
      sourceEntryIds: ["bruno", "carla"],
    });
    expect(context.calendarReferences?.[0]?.dates).toHaveLength(14);
    expect(context.calendarReferences?.[0]?.dates).toEqual(
      expect.arrayContaining([
        { date: "2026-10-18", weekday: "Sunday" },
        { date: "2026-10-19", weekday: "Monday" },
        { date: "2026-10-21", weekday: "Wednesday" },
        { date: "2026-10-28", weekday: "Wednesday" },
      ]),
    );
  });

  it("anchors each calendar to the spoken local day instead of UTC or the process clock", () => {
    const context = createSummaryInput([
      entry("local", "2026-10-19T01:00:00.000Z"),
      entry("utc", "2026-10-19T01:00:00.000Z", "UTC"),
    ]);
    expect(context.calendarReferences?.map(({ referenceDate }) => referenceDate)).toEqual([
      "2026-10-18",
      "2026-10-19",
    ]);
  });

  it.each([
    ["2026-03-07T18:00:00.000Z", "America/New_York", "2026-03-08", "Sunday"],
    ["2026-12-31T18:00:00.000Z", "UTC", "2027-01-01", "Friday"],
  ])(
    "keeps calendar days consecutive across DST and year boundaries",
    (instant, timeZone, date, weekday) => {
      const context = createSummaryInput([entry("anchor", instant, timeZone)]);
      expect(context.calendarReferences?.[0]?.dates[1]).toEqual({ date, weekday });
    },
  );

  it("rejects an invalid source zone instead of silently choosing another reference", () => {
    expect(() =>
      createSummaryInput([entry("invalid", "2026-10-18T17:41:46.000Z", "invalid/zone")]),
    ).toThrow();
  });
});
