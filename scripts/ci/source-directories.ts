import { stat } from "node:fs/promises";
import { join } from "node:path";

// Main comparisons must also support revisions from before the workspace migration.
const candidates = [
  "apps/bot/src",
  "apps/api/src",
  "packages/shared/src",
  "apps/dashboard/src",
  "src",
  "web/src",
];

export async function productionSourceDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];
  for (const directory of candidates) {
    try {
      if ((await stat(join(root, directory))).isDirectory()) directories.push(directory);
    } catch (error: unknown) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if (directories.length === 0) throw new Error("No production source directories found");
  return directories;
}
