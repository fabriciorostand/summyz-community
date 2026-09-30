import type { RecordingManifest } from "../recording/manifest.js";
import type { GuildAccessResult } from "./guild-ownership-handler.js";

export function isProvenRecordedOwnerTransfer(
  manifest: RecordingManifest,
  ownerCheck: GuildAccessResult,
): boolean {
  return (
    manifest.verifiedOwnerUserId !== undefined &&
    ownerCheck.status === "denied" &&
    ownerCheck.reason === "different_owner" &&
    ownerCheck.connectedUserId === manifest.verifiedOwnerUserId
  );
}
