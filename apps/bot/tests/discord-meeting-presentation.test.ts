import type { PublicSummaryTask } from "summyz-community-shared/summary/summary-result";
import { describe, expect, it } from "vitest";
import {
  createPostTitle,
  formatSummary,
  resolvePublicationText,
} from "../src/discord/discord-meeting-presentation.js";

describe("Discord meeting presentation", () => {
  it.each([
    ["pt-BR", "📎 Transcrição completa da call:"],
    ["en", "📎 Full voice call transcript:"],
  ] as const)(
    "keeps the fixed transcript notice in %s despite generated labels",
    (language, notice) => {
      const text = resolvePublicationText(language, {
        decisions: [],
        discussedTopics: [],
        executiveSummary: "El equipo decidió.",
        labels: {
          assignee: "Responsable",
          deadline: "Plazo",
          decisions: "Decisiones",
          discussedTopics: "Temas tratados",
          executiveSummary: "Resumen ejecutivo",
          fullTranscript: "Transcripción completa",
          meetingId: "ID de la reunión",
          observations: "Observaciones",
          summary: "Resumen",
          tasks: "Tareas",
          transcript: "Transcripción",
        },
        observations: [],
        tasks: [],
      });

      expect(text.fullTranscript).toBe(notice);
      expect(text.executiveSummary).toBe("Resumen ejecutivo");
    },
  );

  it("formats the localized post title and summary sections", () => {
    const text = resolvePublicationText("en");

    expect(createPostTitle("2026-08-17T15:30:00.000Z", "Lobby", "summary", "UTC", "en", text)).toBe(
      "Summary — 08/17/2026 15:30 — Lobby",
    );
    expect(
      formatSummary(
        "meeting-1",
        {
          decisions: ["Adopt the plan."],
          discussedTopics: ["The plan"],
          executiveSummary: "The team agreed.",
          observations: ["Review next week."],
          tasks: [{ text: "Send the file.", ownerNames: ["Ana"], deadlineText: "Friday" }],
        },
        text,
      ).join("\n"),
    ).toContain("## Tasks\n\n- Send the file.\n  - **Assignee:** Ana\n  - **Deadline:** Friday");
  });

  it("lists each task with nested bold details separated by blank lines", () => {
    expect(
      formatTasks([
        {
          deadlineDate: "2026-10-21",
          deadlinePrecision: "date",
          deadlineText: "Até quarta.",
          deadlineTimeZone: "America/Sao_Paulo",
          ownerNames: ["Bruno"],
          text: "Realizar a implementação",
        },
        { ownerNames: ["Bruno", "Carla"], text: "Revisar o layout do PDF" },
        { ownerNames: [], text: "Fazer os testes" },
      ]),
    ).toBe(
      [
        "## Tarefas",
        "",
        "- Realizar a implementação",
        "  - **Responsável:** Bruno",
        "  - **Prazo:** Até quarta (21/10)",
        "",
        "- Revisar o layout do PDF",
        "  - **Responsáveis:** Bruno e Carla",
        "",
        "- Fazer os testes",
      ].join("\n"),
    );
  });

  it.each([
    ["na quinta.", "Na quinta"],
    ["até sexta!?", "Até sexta"],
    ["amanhã…", "Amanhã"],
    ["depois da reunião...", "Depois da reunião"],
    ["semana que vem, ;:", "Semana que vem"],
    ["bis Freitag.", "Bis Freitag"],
    ["até 21/10, no máximo", "Até 21/10, no máximo"],
    ["érable.", "Érable"],
  ])("cleans the spoken deadline %j as %j", (deadlineText, expected) => {
    expect(formatTasks([{ deadlineText, ownerNames: ["Ana"], text: "Enviar." }])).toContain(
      `  - **Prazo:** ${expected}`,
    );
  });

  it("does not repeat the interpreted date already present in the cleaned deadline", () => {
    expect(
      formatTasks([
        {
          deadlineDate: "2026-10-21",
          deadlinePrecision: "date",
          deadlineText: "até 21/10.",
          deadlineTimeZone: "America/Sao_Paulo",
          ownerNames: [],
          text: "Enviar.",
        },
      ]),
    ).toMatch(/\*\*Prazo:\*\* Até 21\/10$/);
  });

  it("keeps the spoken deadline when cleaning would leave it empty", () => {
    expect(formatTasks([{ deadlineText: "...", ownerNames: [], text: "Enviar." }])).toContain(
      "  - **Prazo:** ...",
    );
  });

  it("orders tasks by deadline and keeps the meeting order for ties", () => {
    const dated = (text: string, deadlineDate: string, deadlineTime?: string) => ({
      deadlineDate,
      deadlinePrecision: deadlineTime === undefined ? ("date" as const) : ("minute" as const),
      deadlineText: `prazo ${text}`,
      ...(deadlineTime === undefined ? {} : { deadlineTime }),
      deadlineTimeZone: "America/Sao_Paulo",
      ownerNames: [],
      text,
    });
    const formatted = formatTasks([
      { ownerNames: [], text: "sem prazo 1" },
      { deadlineText: "quando der", ownerNames: [], text: "falado 1" },
      dated("dia 22", "2026-10-22"),
      dated("dia 21 só data 1", "2026-10-21"),
      dated("dia 21 às 15h", "2026-10-21", "15:00"),
      { ownerNames: [], text: "sem prazo 2" },
      dated("dia 21 às 09h", "2026-10-21", "09:00"),
      { deadlineText: "mais tarde", ownerNames: [], text: "falado 2" },
      dated("dia 21 só data 2", "2026-10-21"),
      dated("dia 20 às 15h", "2026-10-20", "15:00"),
    ]);

    expect(
      formatted
        .split("\n")
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2)),
    ).toEqual([
      "dia 20 às 15h",
      "dia 21 às 09h",
      "dia 21 às 15h",
      "dia 21 só data 1",
      "dia 21 só data 2",
      "dia 22",
      "falado 1",
      "falado 2",
      "sem prazo 1",
      "sem prazo 2",
    ]);
  });
});

function formatTasks(tasks: PublicSummaryTask[]): string {
  const chunks = formatSummary(
    "meeting-1",
    { decisions: [], discussedTopics: [], executiveSummary: "Resumo.", observations: [], tasks },
    resolvePublicationText("pt-BR"),
  );
  return chunks.find((chunk) => chunk.startsWith("## Tarefas")) ?? "";
}
