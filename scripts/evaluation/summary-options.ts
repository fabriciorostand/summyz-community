import { parseArgs } from "node:util";
import { z } from "zod";
import { summaryEvaluationCases } from "./summary-cases.js";

export const evaluationHelp = `Avaliação semântica de resumos (execução manual)

  npm run eval:summary -- --list-profiles
  npm run eval:summary -- --profile-id <id> [--device cpu|gpu] [--runs 1..5] [--case <id>]

--profile-id é obrigatório para inferência. --case pode ser repetido; sem ele, todos os casos executam.
Perfis com dispositivo auto exigem --device; não há download automático de modelos.
Relatórios: artifacts/evaluations/*.json e *.md. Saídas: 0 aprovado, 1 falha, 2 revisão pendente.
Casos: ${summaryEvaluationCases.map(({ id }) => id).join(", ")}
`;

export function parseEvaluationOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: "boolean" },
      "list-profiles": { type: "boolean" },
      "profile-id": { type: "string" },
      device: { type: "string" },
      runs: { type: "string" },
      case: { type: "string", multiple: true },
    },
  });
  const common = {
    runs: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .parse(values.runs ?? 1),
    device: z.enum(["cpu", "gpu"]).optional().parse(values.device),
    caseIds: values.case ?? [],
  };
  if (values.help === true) return { ...common, command: "help" as const };
  if (values["list-profiles"] === true) {
    if (values["profile-id"] !== undefined) throw new Error("Choose listing or inference");
    return { ...common, command: "list" as const };
  }
  return {
    ...common,
    command: "run" as const,
    profileId: z.string().trim().min(1).max(256).parse(values["profile-id"]),
  };
}

export function selectEvaluationCases(ids: readonly string[]) {
  if (ids.some((id) => !summaryEvaluationCases.some((item) => item.id === id))) {
    throw new Error("Unknown evaluation case");
  }
  return ids.length === 0
    ? summaryEvaluationCases
    : summaryEvaluationCases.filter(({ id }) => ids.includes(id));
}
