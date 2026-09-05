import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACCEPTANCE_TEXT,
  CLA_VERSION,
  signaturePathFor,
  validateGitHubLogin,
  validateLegalName,
} from "./policy.mjs";

function readArgument(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing required ${name} value.`);
  }
  return value;
}

export async function createSignature({ legalName, githubLogin, rootDirectory, now }) {
  const normalizedName = validateLegalName(legalName);
  const normalizedLogin = validateGitHubLogin(githubLogin);
  const acceptedAt = now.toISOString();
  const relativePath = signaturePathFor(normalizedLogin);
  const absolutePath = resolve(rootDirectory, relativePath);

  try {
    await readFile(absolutePath, "utf8");
    throw new Error(`Signature already exists at ${relativePath}.`);
  } catch (error) {
    if (!(error instanceof Error) || !Object.hasOwn(error, "code") || error.code !== "ENOENT") {
      throw error;
    }
  }

  const record = {
    agreement: "Summyz Individual Contributor License Agreement",
    claVersion: CLA_VERSION,
    legalName: normalizedName,
    githubLogin: normalizedLogin,
    acceptedAt,
    acceptanceText: ACCEPTANCE_TEXT,
  };

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return relativePath;
}

async function main() {
  const legalName = readArgument(process.argv.slice(2), "--name");
  const githubLogin = readArgument(process.argv.slice(2), "--login");
  const relativePath = await createSignature({
    legalName,
    githubLogin,
    rootDirectory: process.cwd(),
    now: new Date(),
  });
  process.stdout.write(`Created ${relativePath}. Review and commit it with your pull request.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (
  import.meta.url === invokedPath &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown CLA signature failure.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
