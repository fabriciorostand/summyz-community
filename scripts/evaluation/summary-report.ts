import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SummaryEvaluationCase } from "./summary-cases.js";
import type { SummaryEvaluation } from "./summary-evaluation.js";
import type { createEvaluationTarget } from "./summary-target.js";

type TargetMetadata = ReturnType<typeof createEvaluationTarget>["metadata"];
function jsonBlock(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}
export function evaluationExitCode(status: SummaryEvaluation["status"]): number {
  return { passed: 0, failed: 1, review: 2 }[status];
}
export async function writeEvaluationReport(options: {
  directory: string;
  cases: readonly SummaryEvaluationCase[];
  target: TargetMetadata;
  evaluation: SummaryEvaluation;
}) {
  const report = {
    createdAt: new Date().toISOString(),
    target: options.target,
    cases: options.cases,
    evaluation: options.evaluation,
  };
  const filename = `summary-${Date.now()}-${randomUUID()}`;
  await mkdir(options.directory, { recursive: true });
  const json = path.resolve(options.directory, `${filename}.json`);
  const markdown = path.resolve(options.directory, `${filename}.md`);
  const sections = options.evaluation.results.map((result) => {
    const scenario = options.cases.find(({ id }) => id === result.caseId);
    return [
      `## ${result.caseId} — execução ${result.run}: ${result.status}`,
      scenario?.entries.map((entry) => `${entry.speaker}: ${entry.text}`).join("\n\n"),
      `Referências temporais: ${JSON.stringify(scenario?.entries.map(({ spokenAt }) => spokenAt))}`,
      "### Esperado (variantes aceitas)",
      jsonBlock(scenario?.variants),
      "### Obtido e divergências",
      jsonBlock({ tasks: result.actual, issues: result.issues }),
      result.reviewReason,
    ]
      .filter((item) => item !== undefined)
      .join("\n\n");
  });
  const content = [
    "# Avaliação semântica de resumos",
    `Resultado: ${options.evaluation.status}`,
    `Perfil/modelo: ${options.target.profileId} / ${options.target.model}`,
    `Configuração:\n\n${jsonBlock(options.target)}`,
    "A comparação automática usa evidências, quantidade de tarefas, responsáveis e datas. A equivalência do texto das ações exige revisão humana; não há juiz de IA. Casos ambíguos permanecem pendentes mesmo quando uma variante é aceita.",
    ...sections,
    "## Consistência entre execuções",
    jsonBlock(options.evaluation.consistency),
  ].join("\n\n");
  await writeFile(json, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await writeFile(markdown, `${content}\n`, { flag: "wx" });
  return { json, markdown };
}
