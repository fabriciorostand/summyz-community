import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Vitest skips stylesheet processing, so the source is read as plain text.
const styles = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

describe("global styles", () => {
  // Tailwind 4 preflight leaves buttons with the default arrow; the base layer brings the pointer
  // back so utilities such as cursor-help and disabled:cursor-not-allowed still win.
  it("shows the pointer on every enabled button from the base layer", () => {
    expect(styles).toMatch(/@layer base\s*{\s*button:not\(:disabled\)\s*{\s*cursor: pointer;/);
  });
});
