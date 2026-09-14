import { access } from "node:fs/promises";

const installationDisabled = process.env.NODE_ENV === "production" || process.env.CI === "true";

let gitMetadataAvailable = true;
try {
  await access(new URL("../.git", import.meta.url));
} catch {
  gitMetadataAvailable = false;
}

if (!installationDisabled && gitMetadataAvailable) {
  const { default: husky } = await import("husky");
  const message = husky();
  if (message) console.error(message);
}
