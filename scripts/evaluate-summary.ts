import path from "node:path";
import { loadConfig } from "summyz-community-bot/config";
import { createPostgresDatabase } from "summyz-community-shared/database/postgres-database";
import { SecretBox } from "summyz-community-shared/security/secret-box";
import { runSummaryEvaluation } from "./evaluation/summary-evaluation.js";
import {
  evaluationHelp,
  parseEvaluationOptions,
  selectEvaluationCases,
} from "./evaluation/summary-options.js";
import { evaluationExitCode, writeEvaluationReport } from "./evaluation/summary-report.js";
import { createEvaluationTarget, readEvaluationInstallation } from "./evaluation/summary-target.js";

let evaluationStage = "arguments";
async function main(): Promise<void> {
  const options = parseEvaluationOptions(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(evaluationHelp);
    return;
  }
  const cases = selectEvaluationCases(options.caseIds);
  evaluationStage = "configuration";
  const config = loadConfig(process.env);
  evaluationStage = "installation";
  const installation = await readEvaluationInstallation(
    createPostgresDatabase(config.databaseUrl),
    new SecretBox(config.secretsKey),
    options.command === "run" ? options.profileId : undefined,
  );
  if (options.command === "list") {
    process.stdout.write(
      `${JSON.stringify(
        installation.profiles.map((profile) => ({
          profileId: profile.profileId,
          name: profile.name,
          provider: profile.summary.provider,
          model: profile.summary.model,
          device: profile.summary.provider === "ollama" ? profile.summary.device : null,
        })),
        null,
        2,
      )}\n`,
    );
    return;
  }
  evaluationStage = "target";
  const profile = installation.profiles.find(({ profileId }) => profileId === options.profileId);
  if (profile === undefined) throw new Error("Evaluation profile is unavailable");
  const target = createEvaluationTarget({
    profile,
    config,
    apiKey: installation.apiKey,
    device: options.device,
  });
  process.stdout.write(
    `${JSON.stringify({ event: "summary_evaluation_started", ...target.metadata })}\n`,
  );
  evaluationStage = "inference";
  const evaluation = await runSummaryEvaluation({
    cases,
    runs: options.runs,
    generator: target.generator,
    onResult: ({ caseId, run, status }) =>
      process.stdout.write(
        `${JSON.stringify({ event: "summary_evaluation_case_completed", caseId, run, status })}\n`,
      ),
  });
  evaluationStage = "report";
  const reports = await writeEvaluationReport({
    directory: path.resolve("artifacts/evaluations"),
    cases,
    target: target.metadata,
    evaluation,
  });
  process.stdout.write(
    `${JSON.stringify({ event: "summary_evaluation_completed", status: evaluation.status, reports })}\n`,
  );
  process.exitCode = evaluationExitCode(evaluation.status);
}

await main().catch(() => {
  // Never log raw configuration, database errors or provider headers.
  process.stderr.write(
    `${JSON.stringify({ event: "summary_evaluation_failed", stage: evaluationStage, message: "Check CLI arguments, database access, complete profile configuration, credentials and device selection. Run --help for usage." })}\n`,
  );
  process.exitCode = 1;
});
