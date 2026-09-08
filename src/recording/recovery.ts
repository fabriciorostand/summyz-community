import {
  type ManifestStatus,
  markManifestCompleted,
  markManifestInterrupted,
  type RecordingManifest,
} from "./manifest.js";

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

export function finalizeInterruptedRecovery(
  manifest: RecordingManifest,
  completedAt: string,
): RecordingManifest {
  const interrupted =
    manifest.status === "recording"
      ? markManifestInterrupted(manifest, completedAt, "process_restart")
      : manifest;
  return markManifestCompleted(interrupted, completedAt);
}
