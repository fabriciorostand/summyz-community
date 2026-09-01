import { describe, expect, it } from "vitest";

import { createMeetingHistorySummary } from "../src/analytics/meeting-history-summary.js";

describe("createMeetingHistorySummary", () => {
  it("usa o idioma efetivo persistido no estado concluído", () => {
    expect(
      createMeetingHistorySummary(
        {
          attempts: 2,
          baseLanguage: "pt",
          baseSummary: {
            decisions: [],
            discussedTopics: [],
            executiveSummary: "Resumo.",
            observations: [],
            tasks: [],
          },
          completedAt: "2026-08-28T01:27:14.888Z",
          effectiveLanguage: "es-MX",
          meetingId: "meeting-1",
          schemaVersion: 1,
          startedAt: "2026-08-28T01:27:05.529Z",
          status: "completed",
          summary: {
            decisions: [],
            discussedTopics: [],
            executiveSummary: "Resumen.",
            observations: [],
            tasks: [],
          },
          translation: { attempts: 1, status: "completed", targetLanguage: "es-MX" },
          updatedAt: "2026-08-28T01:27:14.888Z",
        },
        { botLanguage: "pt-BR" },
      ),
    ).toMatchObject({ executiveSummary: "Resumen.", language: "es-MX", status: "completed" });
  });

  it("rejeita estado de resumo ainda em processamento", () => {
    expect(() =>
      createMeetingHistorySummary(
        {
          attempts: 0,
          meetingId: "meeting-1",
          schemaVersion: 1,
          startedAt: "2026-08-28T01:27:05.529Z",
          status: "processing",
          updatedAt: "2026-08-28T01:27:05.529Z",
        },
        { botLanguage: "pt-BR" },
      ),
    ).toThrow(/processing/i);
  });
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
