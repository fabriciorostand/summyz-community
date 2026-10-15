import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const blockedAgentEmails = new Set([
  "noreply@openai.com",
  "codex@openai.com",
  "noreply@anthropic.com",
  "copilot@github.com",
  "cursoragent@cursor.com",
  "aider@aider.chat",
]);

async function main(): Promise<void> {
  const [messagePath, ...extraArguments] = process.argv.slice(2);
  if (!messagePath || extraArguments.length > 0) {
    throw new Error("Expected exactly one commit message file.");
  }

  const { stdout } = await run(
    "git",
    ["-c", "trailer.separators=:", "interpret-trailers", "--parse", "--", messagePath],
    { encoding: "utf8" },
  );

  const blocked = stdout.split(/\r?\n/u).some((line) => {
    const match = /^co-authored-by:[ \t]*.*<([^<>\s]+)>[ \t]*$/isu.exec(line);
    const email = match?.[1];
    return email !== undefined && blockedAgentEmails.has(email.toLowerCase());
  });
  if (blocked) {
    process.stderr.write(
      "Known AI agent co-authorship is not allowed. Remove the agent trailer; human co-authors are permitted by this local hook.\n",
    );
    process.exitCode = 1;
  }
}

main().catch(() => {
  // Never print commit contents, paths, or child-process errors containing sensitive data.
  process.stderr.write("Unable to validate commit authorship. Commit aborted.\n");
  process.exitCode = 1;
});
