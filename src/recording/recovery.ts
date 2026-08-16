import type { ManifestStatus } from "./manifest.js";

export type RecoveryDecision = "finalize_interrupted" | "ignore" | "resume";

export interface RecoveryInput {
  humanCount: number;
  manifestStatus: ManifestStatus;
}

export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  if (input.manifestStatus === "completed") {
    return "ignore";
  }

  return input.humanCount > 0 ? "resume" : "finalize_interrupted";
}
