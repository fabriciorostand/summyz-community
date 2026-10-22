import {
  createPublicSummary,
  publicSummarySchema,
  validateGroundedSummary,
} from "summyz-community-shared/summary/summary-result";
import { describe, expect, it } from "vitest";
import {
  formatSummary,
  resolvePublicationText,
} from "../src/discord/discord-meeting-presentation.js";

const entries = [
  {
    id: "bruno",
    speaker: "Bruno",
    text: "Implementação comigo. Até quarta!",
    startedAtMs: 0,
    endedAtMs: 1000,
    spokenAt: { instant: "2026-10-18T17:41:46.000Z", timeZone: "America/Sao_Paulo" },
  },
  {
    id: "carla",
    speaker: "Carla",
    text: "Eu reviso o layout do PDF.",
    startedAtMs: 1000,
    endedAtMs: 2000,
  },
  {
    id: "diego",
    speaker: "Diego",
    text: "Eu faço os testes na quinta.",
    startedAtMs: 2000,
    endedAtMs: 3000,
  },
];
const base = {
  decisions: [],
  discussedTopics: [],
  executiveSummary: "Planejamento.",
  observations: [],
};

describe("atribuições contextuais e apresentação das tarefas", () => {
  it("preserva compromissos em primeira pessoa e responsáveis compartilhados escolhidos pela IA", () => {
    const result = validateGroundedSummary(
      {
        ...base,
        tasks: [
          { text: "Implementação", ownerNames: ["Bruno"], sourceEntryIds: ["bruno"] },
          { text: "Revisar o layout do PDF", ownerNames: ["Carla"], sourceEntryIds: ["carla"] },
          { text: "Fazer os testes", ownerNames: ["Diego"], sourceEntryIds: ["diego"] },
          {
            text: "Revisar juntos",
            ownerNames: ["Carla", "Diego"],
            sourceEntryIds: ["carla", "diego"],
          },
        ],
      },
      entries,
    );
    expect(createPublicSummary(result).tasks.map((task) => task.ownerNames)).toEqual([
      ["Bruno"],
      ["Carla"],
      ["Diego"],
      ["Carla", "Diego"],
    ]);
  });

  it("preserva terceiros identificados pelo modelo sem relaxar evidências e prazos literais", () => {
    const result = validateGroundedSummary(
      {
        ...base,
        tasks: [
          {
            text: "Consultar fornecedor",
            ownerNames: ["Pessoa externa"],
            deadlineText: "amanhã",
            sourceEntryIds: ["bruno"],
          },
          { text: "Sem evidência", ownerNames: ["Bruno"], sourceEntryIds: ["missing"] },
        ],
      },
      entries,
    );
    expect(result.tasks).toEqual([
      { text: "Consultar fornecedor", ownerNames: ["Pessoa externa"], sourceEntryIds: ["bruno"] },
    ]);
  });

  it("aninha responsável e prazo como subitens e ordena as tarefas pelo prazo", () => {
    const summary = publicSummarySchema.parse({
      ...base,
      tasks: [
        {
          text: "Implementação",
          ownerNames: ["Bruno"],
          deadlineText: "Até quarta!",
          deadlineDate: "2026-10-21",
          deadlinePrecision: "date",
          deadlineTimeZone: "America/Sao_Paulo",
        },
        { text: "Revisar o layout do PDF", ownerNames: ["Carla"] },
        {
          text: "Fazer os testes de integração",
          ownerNames: [],
          deadlineText: "quinta",
          deadlineDate: "2026-10-22",
          deadlinePrecision: "date",
          deadlineTimeZone: "America/Sao_Paulo",
        },
        { text: "Verificar melhorias", ownerNames: ["Carla", "Diego"] },
      ],
    });
    const text = formatSummary("meeting", summary, resolvePublicationText("pt-BR")).join("\n");
    expect(text).toContain(
      "## Tarefas\n\n- Implementação\n  - **Responsável:** Bruno\n  - **Prazo:** Até quarta (21/10)\n\n- Fazer os testes de integração\n  - **Prazo:** Quinta (22/10)\n\n- Revisar o layout do PDF\n  - **Responsável:** Carla\n\n- Verificar melhorias\n  - **Responsáveis:** Carla e Diego",
    );
  });

  it.each([
    ["hoje", "Hoje"],
    ["amanhã", "Amanhã"],
    ["daqui a três dias", "Daqui a três dias"],
    ["segunda-feira, dia 22", "Segunda-feira, dia 22"],
  ])(
    "exibe a data interpretada pela IA para %s sem substituir o prazo literal",
    (deadlineText, presentedDeadline) => {
      const result = validateGroundedSummary(
        {
          ...base,
          tasks: [
            {
              text: "Entregar",
              ownerNames: [],
              sourceEntryIds: ["date"],
              deadlineText,
              deadlineDate: "2026-10-22",
              deadlinePrecision: "date",
              deadlineTimeZone: "America/Sao_Paulo",
            },
          ],
        },
        [
          {
            ...entries[0],
            id: "date",
            speaker: "Bruno",
            text: deadlineText,
            startedAtMs: 0,
            endedAtMs: 1000,
          },
        ],
      );
      const text = formatSummary(
        "meeting",
        createPublicSummary(result),
        resolvePublicationText("pt-BR"),
      ).join("\n");
      expect(text).toContain(`**Prazo:** ${presentedDeadline} (22/10)`);
    },
  );

  it("continua lendo resumos antigos sem alterar os dados armazenados", () => {
    const legacy = {
      ...base,
      tasks: [{ text: "Entregar", ownerName: "Bruno", deadlineText: "quarta" }],
    };
    expect(publicSummarySchema.parse(legacy)).toEqual(legacy);
  });
});
