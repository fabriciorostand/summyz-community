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

/** The dark default tokens and the first light override block, which holds the light tokens. */
const darkTokens = styles.match(/@theme \{([^}]*)\}/)?.[1] ?? "";
const lightTokens = styles.match(/:root\[data-theme="light"\] \{([^}]*)\}/)?.[1] ?? "";

describe("chart series palette", () => {
  // Validated for colour-vision deficiency and 3:1 contrast against each theme's surface, in this
  // order; the action tokens stay out of charts because action and accent share a hue in light.
  it.each([
    ["series-1", "#8b7bff", "#5a3fe0"],
    ["series-2", "#1e9eac", "#008c9e"],
    ["series-3", "#d9692f", "#c4561c"],
    ["series-4", "#c357b0", "#a8389a"],
    ["series-other", "#4a5068", "#b4b7c6"],
  ])("sets --color-%s to %s in dark and %s in light", (token, dark, light) => {
    expect(darkTokens).toContain(`--color-${token}: ${dark};`);
    expect(lightTokens).toContain(`--color-${token}: ${light};`);
  });

  it("keeps no single-purpose chart colour beside the series", () => {
    expect(styles).not.toContain("--color-chart-");
  });
});

describe("action palette", () => {
  // Violet-to-blue from the Summyz logo; the light theme uses a darker gradient, like the old
  // blurple mapping, and keeps action and accent on the same hue.
  it.each([
    ["action", "#5a2df0", "#4a22d0"],
    ["action-soft", "#1a1639", "#eeeafc"],
    ["accent", "#9b8cff", "#4a22d0"],
    ["accent-hover", "#b9afff", "#3d1bb0"],
    ["action-from", "#7017e6", "#5c10c2"],
    ["action-to", "#2a41fa", "#1f33d6"],
    ["action-hover-from", "#5c10c2", "#4a0ca0"],
    ["action-hover-to", "#1f33d6", "#1828b0"],
  ])("sets --color-%s to %s in dark and %s in light", (token, dark, light) => {
    expect(darkTokens).toContain(`--color-${token}: ${dark};`);
    expect(lightTokens).toContain(`--color-${token}: ${light};`);
  });

  it("keeps no solid action hover token now that primary actions hover through the gradient", () => {
    expect(styles).not.toMatch(/--color-action-hover:/);
  });

  it("paints the navigation progress bar with the logo gradient", () => {
    expect(styles).toMatch(
      /html \.bprogress \.bar \{\s*background: linear-gradient\(120deg, var\(--color-action-from\), var\(--color-action-to\)\);/,
    );
  });

  it("paints primary actions with the gradient and darkens its stops on hover", () => {
    expect(utility("bg-action-gradient")).toContain(
      "@apply bg-linear-120 from-action-from to-action-to;",
    );
    expect(utility("bg-action-gradient-hover")).toContain(
      "@apply from-action-hover-from to-action-hover-to;",
    );
  });
});

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
