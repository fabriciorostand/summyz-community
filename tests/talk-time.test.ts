import { describe, expect, it } from "vitest";

import { calculateTalkTime } from "../src/analytics/talk-time.js";

describe("calculateTalkTime", () => {
  it("unifies overlaps from the same participant and preserves simultaneous speech", () => {
    expect(
      calculateTalkTime(
        [
          { displayName: "Ana", userId: "ana" },
          { displayName: "Bia", userId: "bia" },
          { displayName: "Caio", userId: "caio" },
        ],
        [
          { endedAtMs: 1_000, startedAtMs: 0, userId: "ana" },
          { endedAtMs: 500, startedAtMs: 0, userId: "ana" },
          { endedAtMs: 1_500, startedAtMs: 500, userId: "ana" },
          { endedAtMs: 1_500, startedAtMs: 500, userId: "bia" },
        ],
      ),
    ).toEqual([
      { displayName: "Ana", percentage: 60, talkTimeMs: 1_500, userId: "ana" },
      { displayName: "Bia", percentage: 40, talkTimeMs: 1_000, userId: "bia" },
      { displayName: "Caio", percentage: 0, talkTimeMs: 0, userId: "caio" },
    ]);
  });

  it("distributes integer remainders so spoken percentages total exactly one hundred", () => {
    const result = calculateTalkTime(
      [
        { displayName: "A", userId: "a" },
        { displayName: "B", userId: "b" },
        { displayName: "C", userId: "c" },
      ],
      [
        { endedAtMs: 1, startedAtMs: 0, userId: "a" },
        { endedAtMs: 1, startedAtMs: 0, userId: "b" },
        { endedAtMs: 1, startedAtMs: 0, userId: "c" },
      ],
    );

    expect(result.map((participant) => participant.percentage)).toEqual([34, 33, 33]);
    expect(result.reduce((total, participant) => total + participant.percentage, 0)).toBe(100);
  });

  it("returns zero for every attendee when no speech was detected", () => {
    expect(calculateTalkTime([{ displayName: "Ana", userId: "ana" }], [])).toEqual([
      { displayName: "Ana", percentage: 0, talkTimeMs: 0, userId: "ana" },
    ]);
  });

  it("sums separate speaking intervals without counting the gap", () => {
    expect(
      calculateTalkTime(
        [{ displayName: "Ana", userId: "ana" }],
        [
          { endedAtMs: 500, startedAtMs: 0, userId: "ana" },
          { endedAtMs: 1_500, startedAtMs: 1_000, userId: "ana" },
        ],
      ),
    ).toEqual([{ displayName: "Ana", percentage: 100, talkTimeMs: 1_000, userId: "ana" }]);
  });

  it.each([
    { endedAtMs: 1, startedAtMs: -1, userId: "ana" },
    { endedAtMs: 1, startedAtMs: Number.NaN, userId: "ana" },
    { endedAtMs: Number.NaN, startedAtMs: 0, userId: "ana" },
    { endedAtMs: 1, startedAtMs: 1, userId: "ana" },
  ])("rejects an invalid spoken interval", (interval) => {
    expect(() => calculateTalkTime([{ displayName: "Ana", userId: "ana" }], [interval])).toThrow(
      /invalid/i,
    );
  });
});
