import { describe, expect, it } from "vitest";

import {
  createPublicSummary,
  validateGroundedSummary,
  type SummaryDraft,
  type SummaryTranscriptEntry,
} from "../src/summary/summary-result.js";

const transcript: SummaryTranscriptEntry[] = [
  {
    endedAtMs: 12_000,
    id: "entry-1",
    speaker: "Ana",
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
    protectedTerms: ["Bruno", "Projeto inexistente"],
    tasks: [
      {
        deadlineText: "até sexta-feira",
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
      deadlineText: "até sexta-feira",
      ownerName: "Bruno",
    });
    expect(result.tasks[1]).toEqual({
      sourceEntryIds: ["entry-1"],
      text: "Revisar o orçamento.",
    });
  });

  it("aceita para proteção somente termos que aparecem literalmente na transcrição", () => {
    const result = validateGroundedSummary(createDraft(), transcript);

    expect(result.protectedTerms).toEqual(["Bruno"]);
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
          deadlineText: "até sexta-feira",
          ownerName: "Bruno",
          text: "Enviar o orçamento.",
        },
        { text: "Revisar o orçamento." },
      ],
    });
    expect(JSON.stringify(publicSummary)).not.toContain("entry-");
  });
});
