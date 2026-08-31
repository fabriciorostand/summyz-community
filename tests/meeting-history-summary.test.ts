import { describe, expect, it } from "vitest";

import { createMeetingHistorySummary } from "../src/analytics/meeting-history-summary.js";

describe("createMeetingHistorySummary", () => {
  it("preserva somente o estado público de uma falha no idioma da reunião", () => {
    expect(
      createMeetingHistorySummary(
        {
          attempts: 4,
          failedAt: "2026-08-28T01:27:14.888Z",
          failureCode: "provider_failed",
          meetingId: "meeting-1",
          schemaVersion: 1,
          startedAt: "2026-08-28T01:27:05.529Z",
          status: "failed",
          updatedAt: "2026-08-28T01:27:14.888Z",
        },
        { botLanguage: "en" },
      ),
    ).toEqual({ language: "en", status: "failed" });
  });

  it("não infere idioma quando o manifesto não o fixou", () => {
    expect(() =>
      createMeetingHistorySummary(
        {
          attempts: 1,
          failedAt: "2026-08-28T01:27:14.888Z",
          failureCode: "provider_failed",
          meetingId: "meeting-1",
          schemaVersion: 1,
          startedAt: "2026-08-28T01:27:05.529Z",
          status: "failed",
          updatedAt: "2026-08-28T01:27:14.888Z",
        },
        {},
      ),
    ).toThrow();
  });
});
