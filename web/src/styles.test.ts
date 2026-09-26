import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Vitest skips stylesheet processing, so the sources are read as plain text.
const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, "styles.css"), "utf8");
const page = readFileSync(join(here, "..", "index.html"), "utf8");

/** The declarations of one `@utility` block, without the braces. */
function utility(name: string): string {
  return styles.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";
}

describe("global styles", () => {
  // Tailwind 4 preflight leaves buttons with the default arrow; the base layer brings the pointer
  // back so utilities such as cursor-help and disabled:cursor-not-allowed still win.
  it("shows the pointer on every enabled button from the base layer", () => {
    expect(styles).toMatch(/@layer base\s*{\s*button:not\(:disabled\)\s*{\s*cursor: pointer;/);
  });

  it("uses Martian Mono as the monospace face", () => {
    expect(styles).toMatch(/--font-mono: "Martian Mono",/);
    expect(styles).not.toContain("JetBrains Mono");
  });

  it("sets the uppercase micro-labels at 9px, regular weight and 0.1em tracking", () => {
    const label = utility("label-mono");
    expect(label).toContain("font-size: 0.5625rem;");
    expect(label).toContain("font-weight: 400;");
    expect(label).toContain("letter-spacing: 0.1em;");
    expect(label).toContain("text-transform: uppercase;");
  });

  it("keeps no unused label tokens", () => {
    expect(styles).not.toContain("--text-label");
  });
});

describe("font loading", () => {
  it("requests only the semi-condensed width of Martian Mono in the weights the UI uses", () => {
    expect(page).toContain("family=Martian+Mono:wdth,wght@87.5,400..700");
    expect(page).not.toContain("JetBrains");
  });
});
