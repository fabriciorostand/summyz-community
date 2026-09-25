import { describe, expect, it } from "vitest";

import {
  createPublicSummary,
  type SummaryDraft,
  type SummaryTranscriptEntry,
  validateGroundedSummary,
} from "../src/summary/summary-result.js";

const transcript: SummaryTranscriptEntry[] = [
  {
    endedAtMs: 12_000,
    id: "entry-1",
    speaker: "Ana",
    spokenAt: { instant: "2026-08-16T13:00:10.000Z", timeZone: "America/Sao_Paulo" },
    startedAtMs: 10_000,
    text: "Bruno, envie o orçamento até sexta-feira.",
  },
  {
    endedAtMs: 24_000,
    id: "entry-2",
    speaker: "Bruno",
    startedAtMs: 20_000,
    text: "Está decidido: vamos adotar o novo fluxo.",
  },
  {
    endedAtMs: 34_000,
    id: "entry-3",
    speaker: "Ana",
    startedAtMs: 30_000,
    text: "Alguém precisa decidir qual ferramenta será usada.",
  },
];

function createDraft(): SummaryDraft {
  return {
    decisions: [
      { sourceEntryIds: ["entry-2"], text: "Adotar o novo fluxo." },
      { sourceEntryIds: ["missing"], text: "Contratar dez pessoas." },
    ],
    discussedTopics: ["Novo fluxo de aprovação", "Orçamento"],
    executiveSummary: "A equipe discutiu orçamento e um novo fluxo de aprovação.",
    observations: ["Ficou pendente decidir qual ferramenta será usada."],
    tasks: [
      {
        deadlineDate: "2026-08-21",
        deadlinePrecision: "date",
        deadlineText: "até sexta-feira",
        deadlineTimeZone: "America/Sao_Paulo",
        ownerName: "Bruno",
        sourceEntryIds: ["entry-1"],
        text: "Enviar o orçamento.",
      },
      {
        deadlineText: "amanhã",
        ownerName: "Carlos",
        sourceEntryIds: ["entry-1"],
        text: "Revisar o orçamento.",
      },
      {
        sourceEntryIds: ["missing"],
        text: "Publicar o relatório.",
      },
    ],
  };
}

describe("resultado estruturado do resumo", () => {
  it("remove decisões e tarefas sem origem válida", () => {
    const result = validateGroundedSummary(createDraft(), transcript);

    expect(result.decisions).toEqual([
      { sourceEntryIds: ["entry-2"], text: "Adotar o novo fluxo." },
    ]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => task.text)).not.toContain("Publicar o relatório.");
  });

  it("preserva responsável e prazo somente quando aparecem exatamente na fala de origem", () => {
    const result = validateGroundedSummary(createDraft(), transcript);

    expect(result.tasks[0]).toMatchObject({
      deadlineDate: "2026-08-21",
      deadlinePrecision: "date",
      deadlineText: "até sexta-feira",
      deadlineTimeZone: "America/Sao_Paulo",
      ownerName: "Bruno",
    });
    expect(result.tasks[1]).toEqual({
      sourceEntryIds: ["entry-1"],
      text: "Revisar o orçamento.",
    });
  });

  it("remove as evidências do conteúdo público e mantém tarefas sem responsável ou prazo", () => {
    const publicSummary = createPublicSummary(validateGroundedSummary(createDraft(), transcript));

    expect(publicSummary).toEqual({
      decisions: ["Adotar o novo fluxo."],
      discussedTopics: ["Novo fluxo de aprovação", "Orçamento"],
      executiveSummary: "A equipe discutiu orçamento e um novo fluxo de aprovação.",
      observations: ["Ficou pendente decidir qual ferramenta será usada."],
      tasks: [
        {
          deadlineDate: "2026-08-21",
          deadlinePrecision: "date",
          deadlineText: "até sexta-feira",
          deadlineTimeZone: "America/Sao_Paulo",
          ownerName: "Bruno",
          text: "Enviar o orçamento.",
        },
        { text: "Revisar o orçamento." },
      ],
    });
    expect(JSON.stringify(publicSummary)).not.toContain("entry-");
  });

  it("accepts minute precision only with a complete normalized deadline", () => {
    const firstEntry = transcript[0];
    if (firstEntry === undefined) throw new Error("Expected the summary fixture entry");
    const result = validateGroundedSummary(
      {
        ...createDraft(),
        tasks: [
          {
            deadlineDate: "2026-08-17",
            deadlinePrecision: "minute",
            deadlineText: "amanhã às 20:30",
            deadlineTime: "20:30",
            deadlineTimeZone: "America/Sao_Paulo",
            sourceEntryIds: ["entry-1"],
            text: "Enviar o orçamento.",
          },
        ],
      },
      [{ ...firstEntry, text: "Enviar amanhã às 20:30." }],
    );

    expect(result.tasks[0]).toMatchObject({
      deadlineDate: "2026-08-17",
      deadlinePrecision: "minute",
      deadlineTime: "20:30",
    });
  });

  it("descarta a normalização quando o modelo inventa outro fuso horário", () => {
    const draft = createDraft();
    const firstTask = draft.tasks[0];
    if (firstTask === undefined) throw new Error("Expected the summary fixture task");

    const result = validateGroundedSummary(
      {
        ...draft,
        tasks: [{ ...firstTask, deadlineTimeZone: "Invalid/TimeZone" }],
      },
      transcript,
    );

    expect(result.tasks[0]).toEqual({
      deadlineText: "até sexta-feira",
      ownerName: "Bruno",
      sourceEntryIds: ["entry-1"],
      text: "Enviar o orçamento.",
    });
  });
});
