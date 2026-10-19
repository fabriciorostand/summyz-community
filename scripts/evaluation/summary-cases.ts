import { z } from "zod";
import { summaryTranscriptEntrySchema } from "../../src/summary/summary-result.js";

const expectedTaskSchema = z.object({
  sourceEntryIds: z.array(z.string().min(1)).min(1),
  ownerNames: z.array(z.string().min(1)),
  deadlineDate: z.iso.date().nullable(),
});
export const summaryEvaluationCaseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  entries: z.array(summaryTranscriptEntrySchema).min(1).max(20),
  variants: z.array(z.array(expectedTaskSchema).max(10)).min(1).max(5),
  reviewReason: z.string().min(1).optional(),
});
export type SummaryEvaluationCase = z.infer<typeof summaryEvaluationCaseSchema>;
export type ExpectedTask = z.infer<typeof expectedTaskSchema>;

function entries(id: string, lines: readonly [string, string][]) {
  return lines.map(([speaker, text], index) => ({
    id: `${id}-${index}`,
    speaker,
    text,
    startedAtMs: index * 1000,
    endedAtMs: (index + 1) * 1000,
    spokenAt: { instant: "2026-10-18T17:41:46.000Z", timeZone: "America/Sao_Paulo" },
  }));
}
function singleTask(
  id: string,
  name: string,
  lines: readonly [string, string][],
  ownerNames: string[],
  deadlineDate: string | null,
): SummaryEvaluationCase {
  return {
    id,
    name,
    entries: entries(id, lines),
    variants: [
      [{ sourceEntryIds: lines.map((_, index) => `${id}-${index}`), ownerNames, deadlineDate }],
    ],
  };
}

export const summaryEvaluationCases = z.array(summaryEvaluationCaseSchema).parse([
  {
    id: "contextual-assignments",
    name: "Compromissos pessoais, responsabilidade compartilhada e prazos relativos",
    entries: entries("contextual", [
      ["Bruno", "Eu vou implementar a exportação em PDF até quarta-feira."],
      ["Carla", "Eu e o Diego vamos revisar juntos o layout do PDF amanhã."],
      ["Diego", "Confirmo, eu e a Carla vamos revisar juntos o layout amanhã."],
    ]),
    variants: [
      [
        { sourceEntryIds: ["contextual-0"], ownerNames: ["Bruno"], deadlineDate: "2026-10-21" },
        {
          sourceEntryIds: ["contextual-1", "contextual-2"],
          ownerNames: ["Carla", "Diego"],
          deadlineDate: "2026-10-19",
        },
      ],
    ],
  },
  singleTask(
    "unassigned",
    "Tarefa sem responsável identificado",
    [
      [
        "Ana",
        "Ficou decidido: precisamos executar os testes de integração até quinta-feira. Ainda não definimos quem fará isso.",
      ],
    ],
    [],
    "2026-10-22",
  ),
  singleTask(
    "confirmation",
    "Atribuição confirmada em outra fala",
    [
      ["Ana", "Bruno, você consegue implementar a exportação em PDF?"],
      ["Bruno", "Sim, eu assumo essa implementação."],
    ],
    ["Bruno"],
    null,
  ),
  singleTask(
    "external-owner",
    "Responsável que não participou",
    [
      [
        "Ana",
        "A Fernanda, que não está nesta call, ficou responsável por revisar o contrato. Ela confirmou isso antes da reunião.",
      ],
    ],
    ["Fernanda"],
    null,
  ),
  singleTask(
    "today",
    "Prazo hoje",
    [["Bruno", "Eu vou publicar a documentação hoje."]],
    ["Bruno"],
    "2026-10-18",
  ),
  singleTask(
    "tomorrow",
    "Prazo amanhã",
    [["Carla", "Eu vou revisar o layout amanhã."]],
    ["Carla"],
    "2026-10-19",
  ),
  singleTask(
    "in-three-days",
    "Prazo daqui a três dias",
    [["Diego", "Eu vou entregar os testes daqui a três dias."]],
    ["Diego"],
    "2026-10-21",
  ),
  {
    id: "no-commitment",
    name: "Possibilidades sem compromisso não são tarefas",
    entries: entries("possibility", [
      [
        "Ana",
        "Talvez fosse interessante exportar em PDF algum dia, mas não vamos decidir nem assumir isso agora.",
      ],
    ]),
    variants: [[]],
  },
  {
    ...singleTask(
      "ambiguous-weekday",
      "Referência ambígua ao domingo",
      [["Bruno", "Eu vou revisar a documentação no domingo."]],
      ["Bruno"],
      "2026-10-18",
    ),
    variants: [
      [
        {
          sourceEntryIds: ["ambiguous-weekday-0"],
          ownerNames: ["Bruno"],
          deadlineDate: "2026-10-18",
        },
      ],
      [
        {
          sourceEntryIds: ["ambiguous-weekday-0"],
          ownerNames: ["Bruno"],
          deadlineDate: "2026-10-25",
        },
      ],
    ],
    reviewReason:
      "A fala ocorreu em um domingo sem esclarecer se o prazo é no mesmo dia ou na semana seguinte. Revisar a interpretação escolhida.",
  },
]);
