import { access, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("repository layout", () => {
  it("keeps translated and reference documentation outside the repository root", async () => {
    const expected = [
      "docs/configuration.md",
      "docs/development.md",
      "docs/operations.md",
      "docs/reference/bot-commands.md",
      "docs/legal/CLA-CORPORATE.md",
      "docs/legal/CLA-INDIVIDUAL.md",
      "docs/pt-BR/configuration.md",
      "docs/pt-BR/development.md",
      "docs/pt-BR/installation.md",
      "docs/pt-BR/operations.md",
      "docs/pt-BR/reference/bot-commands.md",
      "docs/pt-BR/release-checklist.md",
      "requirements/ci.in",
      "requirements/ci.lock",
    ];
    const obsolete = [
      "BOT_COMMANDS.md",
      "CLA-CORPORATE.md",
      "CLA-INDIVIDUAL.md",
      "requirements-ci.in",
      "requirements-ci.lock",
      "docs/installation.pt-BR.md",
      "docs/release-checklist.pt-BR.md",
      "docs/revisao-juridica-1.0.md",
      "docs/pt-BR/BOT_COMMANDS.md",
    ];

    await Promise.all(
      expected.map((path) => expect(access(new URL(path, root))).resolves.toBeUndefined()),
    );
    await Promise.all(
      obsolete.map((path) => expect(access(new URL(path, root))).rejects.toThrow()),
    );
  });

  it("uses concise readmes as navigation entry points", async () => {
    const [english, portuguese] = await Promise.all([
      readFile(new URL("README.md", root), "utf8"),
      readFile(new URL("docs/pt-BR/README.md", root), "utf8"),
    ]);

    expect(english.split("\n").length).toBeLessThan(200);
    expect(portuguese.split("\n").length).toBeLessThan(200);
    for (const path of ["configuration.md", "operations.md", "development.md"]) {
      expect(english).toContain(`./docs/${path}`);
      expect(portuguese).toContain(`./${path}`);
    }
  });

  it("documents private vulnerability reporting without exposing sensitive reports", async () => {
    const policy = await readFile(new URL("SECURITY.md", root), "utf8");

    expect(policy).toContain(
      "https://github.com/fabriciorostand/summyz-community/security/advisories/new",
    );
    expect(policy).toMatch(/do not (?:open|report).*(?:public issue|publicly)/iu);
    expect(policy).toMatch(/tokens|audio|transcripts/iu);
    expect(policy).toContain("https://github.com/fabriciorostand/summyz-community/issues");
  });

  it("uses an explicit Docker build-context allowlist", async () => {
    const dockerignore = await readFile(new URL(".dockerignore", root), "utf8");
    const lines = dockerignore.split("\n").filter((line) => line.trim().length > 0);

    expect(lines[0]).toBe("*");
    for (const entry of [
      "!docker/**",
      "!docs/**",
      "!requirements/**",
      "!scripts/**",
      "!services/**",
      "!src/**",
      "!tests/**",
      "!web/**",
    ]) {
      expect(lines).toContain(entry);
    }
    expect(lines).not.toContain("!.env");
  });

  it("centralizes supported caches and generated evidence", async () => {
    const [gitignore, pyproject, localVitest, ciVitest, webVitest] = await Promise.all([
      readFile(new URL(".gitignore", root), "utf8"),
      readFile(new URL("pyproject.toml", root), "utf8"),
      readFile(new URL("vitest.config.ts", root), "utf8"),
      readFile(new URL("vitest.ci.config.ts", root), "utf8"),
      readFile(new URL("web/vite.ci.config.ts", root), "utf8"),
    ]);

    expect(gitignore).toContain(".cache/");
    expect(gitignore).toContain("artifacts/");
    expect(pyproject).toContain('cache-dir = ".cache/ruff"');
    expect(pyproject).toContain('data_file = ".cache/coverage"');
    expect(pyproject).toContain('cache_dir = ".cache/pytest"');
    expect(localVitest).toContain('reportsDirectory: "artifacts/coverage/server"');
    expect(ciVitest).toContain('reportsDirectory: "artifacts/reports/server/coverage"');
    expect(webVitest).toContain('reportsDirectory: "../artifacts/reports/web/coverage"');
  });

  it("keeps every local environment file out of Git except the example", async () => {
    const gitignore = await readFile(new URL(".gitignore", root), "utf8");
    const lines = gitignore.split(/\r?\n/u).map((line) => line.trim());

    expect(lines).toContain(".env");
    expect(lines).toContain(".env.*");
    expect(lines).toContain("!.env.example");
    expect(lines.indexOf("!.env.example")).toBeGreaterThan(lines.indexOf(".env.*"));
  });
});
