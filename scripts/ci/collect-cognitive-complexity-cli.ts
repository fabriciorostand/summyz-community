import { collectCognitiveReports } from "./cognitive-complexity-collection.js";

try {
  await collectCognitiveReports({ rootPath: process.cwd() });
} catch {
  console.error(
    JSON.stringify({
      event: "cognitive_measurement_failed",
      message: "Cognitive measurement reports unavailable.",
    }),
  );
  process.exitCode = 1;
}
