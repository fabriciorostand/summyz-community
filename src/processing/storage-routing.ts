import type { RecordingManifest } from "../recording/manifest.js";

export function requiresPostgres(
  currentStorageMode: RecordingManifest["storageMode"],
  pendingManifests: readonly RecordingManifest[],
): boolean {
  return (
    currentStorageMode === "postgres" ||
    pendingManifests.some((manifest) => manifest.storageMode === "postgres")
  );
}
