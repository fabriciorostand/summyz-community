import {
  type ManifestStatus,
  markManifestCompleted,
  markManifestInterrupted,
  type RecordingManifest,
} from "./manifest.js";
import type { RecordingStopReason } from "./recording-coordinator.js";

export const MAX_RECOVERY_PAUSE_MS = 30 * 60_000;

export function interruptAfterRestart(
  manifest: RecordingManifest,
  previousHeartbeatAt?: string,
  now = new Date().toISOString(),
): RecordingManifest {
  if (manifest.status !== "recording") return manifest;
  const at =
    previousHeartbeatAt !== undefined &&
    Date.parse(previousHeartbeatAt) >= Date.parse(manifest.startedAt) &&
    Date.parse(previousHeartbeatAt) <= Date.parse(now)
      ? previousHeartbeatAt
      : now;
  return markManifestInterrupted(manifest, at, "process_restart");
}

export function shouldAttemptPendingRecovery(manifest: RecordingManifest): boolean {
  return (
    manifest.status !== "completed" && manifest.interruptions.at(-1)?.reason !== "voice_join_failed"
  );
}

export function hasRecoveryWindowExpired(manifest: RecordingManifest, now: string): boolean {
  if (manifest.status !== "interrupted") return false;
  const suspendedAt = manifest.interruptions.at(-1)?.at;
  if (suspendedAt === undefined) return true;
  return Date.parse(now) - Date.parse(suspendedAt) >= MAX_RECOVERY_PAUSE_MS;
}

export function completeRecordingAfterStop(
  manifest: RecordingManifest,
  completedAt: string,
  reason: RecordingStopReason,
): RecordingManifest {
  const stopped =
    reason === "owner_changed"
      ? markManifestInterrupted(manifest, completedAt, "owner_changed")
      : manifest;
  return markManifestCompleted(stopped, completedAt);
}

export function finalizeDeletedChannelRecovery(
  manifest: RecordingManifest,
  completedAt: string,
  unverified = true,
): RecordingManifest {
  return markManifestCompleted(
    markManifestInterrupted(
      manifest,
      completedAt,
      unverified ? "voice_channel_deleted_unverified" : "voice_channel_deleted",
    ),
    completedAt,
  );
}

export function finalizeExpiredRecovery(
  manifest: RecordingManifest,
  completedAt: string,
): RecordingManifest {
  return markManifestCompleted(
    markManifestInterrupted(manifest, completedAt, "recovery_expired"),
    completedAt,
  );
}

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

export async function recoverRecording(
  manifest: RecordingManifest,
  actions: {
    checkAccess(manifest: RecordingManifest): Promise<"allowed" | "denied" | "unknown">;
    finalize(manifest: RecordingManifest): Promise<void>;
    resume(manifest: RecordingManifest): Promise<unknown>;
  },
): Promise<void> {
  const access = await actions.checkAccess(manifest);
  if (access === "allowed") {
    await actions.resume(manifest);
  } else if (access === "denied") {
    await actions.finalize(manifest);
  }
}
