import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/check-commit-message.ts", import.meta.url));
let directory: string;
let messagePath: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "summyz-authorship-"));
  messagePath = join(directory, "commit message.txt");
});

afterAll(async () => {
  if (
    directory &&
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith("summyz-authorship-")
  ) {
    await rm(directory, { recursive: true, force: true });
  }
});

function runValidator(args: string[]) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe("commit message authorship hook", () => {
  it.each([
    ["Codex", "noreply@openai.com"],
    ["Codex", "codex@openai.com"],
    ["Claude Opus", "noreply@anthropic.com"],
    ["Copilot", "copilot@github.com"],
    ["Cursor", "cursoragent@cursor.com"],
    ["aider (model)", "aider@aider.chat"],
  ])("rejects the documented %s agent address %s", async (name, email) => {
    await writeFile(messagePath, `fix(core): work\n\nCo-Authored-By: ${name} <${email}>\n`);
    const result = runValidator([messagePath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Known AI agent co-authorship is not allowed");
  });

  it.each([
    "Co-authored-by: Claude <claude@example.com>",
    "Co-authored-by: Codex <1234+codex@users.noreply.github.com>",
    "Co-authored-by: Alice <alice@openai.com>",
    "Co-authored-by: Alice <alice@anthropic.com>",
    "Co-authored-by: Bob <bob@github.com>",
    "Co-authored-by: Carol <carol@cursor.com>",
    "Co-authored-by: Someone <noreply@openai.com.example.org>",
    "Co-authored-by: Someone <other+noreply@openai.com>",
    "Co-authored-by: Unknown Agent <agent@example.com>",
    "",
  ])("allows identities outside the explicit list: %s", async (trailer) => {
    await writeFile(messagePath, `fix(core): work\n\n${trailer}\n`);
    const result = runValidator([messagePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects a listed email with another name, mixed casing, CRLF, or folded trailers", async () => {
    await writeFile(
      messagePath,
      "fix(core): work\r\n\r\nCo-authored-by: Alice <alice@example.com>\r\ncO-aUtHoReD-bY: Renamed Agent\r\n <NOREPLY@OPENAI.COM>\r\n",
    );
    expect(runValidator([messagePath]).status).toBe(1);
  });

  it("allows examples in the body that Git does not recognize as co-author trailers", async () => {
    await writeFile(
      messagePath,
      "docs(git): explain trailers\n\nCo-authored-by: Codex <noreply@openai.com>\n\nThis is a quoted example, not commit attribution.\n",
    );
    expect(runValidator([messagePath]).status).toBe(0);
  });

  it("fails without exposing secrets, message contents, or paths", async () => {
    const secret = "test-token-do-not-log-123";
    await writeFile(
      messagePath,
      `fix(core): ${secret}\n\nCo-authored-by: ${secret} <noreply@openai.com>\n`,
    );
    const blocked = runValidator([messagePath]);
    const missing = runValidator([join(directory, secret)]);
    const noArgument = runValidator([]);
    for (const result of [blocked, missing, noArgument]) {
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(secret);
      expect(result.stdout + result.stderr).not.toContain(directory);
      expect(result.stderr).not.toBe("");
    }
    expect(runValidator([messagePath, "extra"]).status).toBe(1);
  });

  it("uses the shipped hook to allow human commits and reject agent commits and amendments", async () => {
    const repository = join(directory, "repository");
    await mkdir(join(repository, ".husky"), { recursive: true });
    await mkdir(join(repository, "scripts"));
    await copyFile(script, join(repository, "scripts/check-commit-message.ts"));
    await copyFile(
      new URL("../.husky/commit-msg", import.meta.url),
      join(repository, ".husky/commit-msg"),
    );
    await chmod(join(repository, ".husky/commit-msg"), 0o755);
    await writeFile(join(repository, "package.json"), '{"type":"module"}\n');
    function git(args: string[]) {
      const result = spawnSync(
        "git",
        ["-c", "user.name=Human", "-c", "user.email=human@example.com", ...args],
        {
          cwd: repository,
          encoding: "utf8",
          env: { ...process.env, HUSKY: "1", NODE_NO_WARNINGS: "1" },
        },
      );
      expect(result.error).toBeUndefined();
      return result;
    }
    expect(git(["init"]).status).toBe(0);
    expect(git(["config", "core.hooksPath", ".husky"]).status).toBe(0);
    await writeFile(messagePath, "fix(core): work\n\nCo-authored-by: Claude <human@example.com>\n");
    const humanCommit = git(["commit", "--allow-empty", "-F", messagePath]);
    expect(humanCommit.status, humanCommit.stderr).toBe(0);
    const originalHead = git(["rev-parse", "HEAD"]).stdout;
    await writeFile(messagePath, "fix(core): work\n\nCo-authored-by: Codex <noreply@openai.com>\n");
    for (const args of [[], ["--amend"]]) {
      const result = git(["commit", "--allow-empty", ...args, "-F", messagePath]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Known AI agent co-authorship is not allowed");
      expect(git(["rev-parse", "HEAD"]).stdout).toBe(originalHead);
    }
    expect(await readFile(messagePath, "utf8")).toContain("noreply@openai.com");
  });
});
