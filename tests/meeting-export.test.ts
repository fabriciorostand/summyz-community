import { describe, expect, it } from "vitest";

import {
  createMeetingTextExport,
  MeetingExportUnavailableError,
} from "../src/api/meeting-export.js";
import type { MeetingHistoryDetail } from "../src/database/postgres-analytics-store.js";

describe("meeting text export", () => {
  it("uses English metadata while preserving generated section labels for other languages", () => {
    const meeting = completedMeeting();
    if (meeting.summary?.status !== "completed" || meeting.summary.labels === undefined) {
      throw new Error("Completed summary labels fixture is invalid");
    }
    const content = createMeetingTextExport(
      {
        ...meeting,
        summary: {
          ...meeting.summary,
          language: "es",
          labels: { ...meeting.summary.labels, summary: "Resumen", tasks: "Tareas" },
        },
      },
      { dateFormat: "MM/DD/YYYY", timeFormat: "12h", timeZone: "UTC" },
    );
    expect(content).toContain("Voice channel: planejamento");
    expect(content).toContain("Started at: 09/08/2026 12:00 PM");
    expect(content).toContain("Time zone: UTC");
    expect(content).toContain("\nResumen\n");
    expect(content).toContain("\nTareas\n");
    expect(content).toContain("amanhã às 20h");
  });

  it("exports stable metadata, localized summary sections and the retained transcript", () => {
    const content = createMeetingTextExport(completedMeeting(), {
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      timeZone: "America/Sao_Paulo",
    });

    expect(content).toContain("Canal de voz: planejamento");
    expect(content).toContain("Início: 08/09/2026 09:00");
    expect(content).toContain("Duração: 01:01:01");
    expect(content).toContain("ID da reunião: meeting-1");
    expect(content).toContain("Síntese executiva\nAlinhamento da entrega.");
    expect(content).toContain("- Publicar a versão (Responsável: Ana; Prazo: amanhã às 20h)");
    expect(content).toContain("Transcrição\n[09:00] Ana: Vamos publicar.");
  });

  it.each([
    { summary: { language: "pt-BR" as const, status: "failed" as const } },
    { transcript: null },
  ])("keeps export unavailable without both completed summary and transcript", (override) => {
    expect(() =>
      createMeetingTextExport(
        { ...completedMeeting(), ...override },
        { dateFormat: "YYYY-MM-DD", timeFormat: "24h", timeZone: "UTC" },
      ),
    ).toThrow(MeetingExportUnavailableError);
  });

  it("uses English fallbacks and explicit placeholders for missing optional data", () => {
    const meeting = completedMeeting();
    if (meeting.summary?.status !== "completed") {
      throw new Error("Completed summary fixture is invalid");
    }
    const { labels: _labels, ...summaryWithoutLabels } = meeting.summary;

    const content = createMeetingTextExport(
      {
        ...meeting,
        durationMs: null,
        summary: {
          ...summaryWithoutLabels,
          decisions: [],
          discussedTopics: [],
          language: "en",
          observations: [],
          tasks: [{ text: "Publish" }],
        },
        voiceChannelName: null,
      },
      { dateFormat: "YYYY-MM-DD", timeFormat: "24h", timeZone: "UTC" },
    );

    expect(content).toContain("Voice channel: -");
    expect(content).toContain("Duration: -");
    expect(content).toContain("Executive summary");
    expect(content).toContain("Decisions\n-");
    expect(content).toContain("Tasks\n- Publish");
  });
});

function completedMeeting(): MeetingHistoryDetail {
  return {
    aiProfile: { name: "Padrão OpenRouter", profileId: "profile-1" },
    audioRetained: false,
    completedAt: "2026-09-08T13:01:01.000Z",
    contentRetained: true,
    cost: {
      attemptCounts: { confirmed: 0, notApplicable: 0, pending: 0, unattributed: 0 },
      breakdown: [],
      confirmed: [],
    },
    discordUrl: "https://discord.com/channels/guild-1/forum-1/post-1",
    durationMs: 3_661_000,
    failureCode: null,
    meetingId: "meeting-1",
    participants: [],
    pipelineStatus: "completed",
    rawTranscript: "raw",
    startedAt: "2026-09-08T12:00:00.000Z",
    summary: {
      decisions: ["Publicar na terça-feira."],
      discussedTopics: ["Entrega"],
      executiveSummary: "Alinhamento da entrega.",
      labels: {
        assignee: "Responsável",
        deadline: "Prazo",
        decisions: "Decisões",
        discussedTopics: "Tópicos discutidos",
        executiveSummary: "Síntese executiva",
        fullTranscript: "Transcrição completa",
        meetingId: "ID da reunião",
        observations: "Observações",
        summary: "Resumo",
        tasks: "Tarefas",
        transcript: "Transcrição",
      },
      language: "pt-BR",
      observations: [],
      status: "completed",
      tasks: [
        {
          deadlineDate: "2026-09-09",
          deadlinePrecision: "minute",
          deadlineText: "amanhã às 20h",
          deadlineTime: "20:00",
          deadlineTimeZone: "America/Sao_Paulo",
          ownerName: "Ana",
          text: "Publicar a versão",
        },
      ],
    },
    transcript: "[09:00] Ana: Vamos publicar.",
    voiceChannelName: "planejamento",
  };
}
