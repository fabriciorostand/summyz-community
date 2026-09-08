import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DISPLAY_COMMAND = "docker scout sbom";
const repositoryRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultNpmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCli = process.env.npm_execpath ?? (existsSync(defaultNpmCli) ? defaultNpmCli : undefined);
const argumentsSet = new Set(process.argv.slice(2));
const allowDirty = argumentsSet.has("--allow-dirty");
const sourceOnly = argumentsSet.has("--source-only");
const outputArgument = process.argv.indexOf("--output");
const outputDirectory = resolve(
  repositoryRoot,
  outputArgument === -1 ? "artifacts/sbom" : process.argv[outputArgument + 1],
);

if (outputArgument !== -1 && process.argv[outputArgument + 1] === undefined) {
  throw new Error("--output requires a directory");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? "unknown process error";
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

const dirtyState = run("git", ["status", "--porcelain"]);
if (dirtyState.length > 0 && !allowDirty) {
  throw new Error(
    "Refusing to generate release SBOM from a dirty tree. Commit first or use --allow-dirty only for local validation.",
  );
}

const targetConfiguration = JSON.parse(
  readFileSync(new URL("./sbom-targets.json", import.meta.url), "utf8"),
);
const targets = [
  { name: "source", reference: "package-lock.json", source: true },
  ...(sourceOnly ? [] : targetConfiguration.images),
];
const formats = [
  { extension: "cdx.json", scout: "cyclonedx" },
  { extension: "spdx.json", scout: "spdx" },
];
const temporaryDirectory = mkdtempSync(join(tmpdir(), "summyz-sbom-"));
const generated = [];

try {
  for (const target of targets) {
    for (const format of formats) {
      const filename = `${target.name}.${format.extension}`;
      const temporaryPath = join(temporaryDirectory, filename);
      process.stdout.write(
        target.source === true
          ? `npm sbom --omit=dev --sbom-format ${format.scout}\n`
          : `${DISPLAY_COMMAND} ${target.reference} --format ${format.scout}\n`,
      );
      if (target.source === true) {
        if (npmCli === undefined) {
          throw new Error(
            "Unable to locate npm CLI; run the generator through npm run release:sbom",
          );
        }
        const sourceSbom = run(process.execPath, [
          npmCli,
          "sbom",
          "--package-lock-only",
          "--omit=dev",
          `--sbom-format=${format.scout}`,
        ]);
        writeFileSync(temporaryPath, `${sourceSbom}\n`, "utf8");
      } else {
        run("docker", [
          "scout",
          "sbom",
          target.reference,
          "--format",
          format.scout,
          "--output",
          temporaryPath,
        ]);
      }
      const content = readFileSync(temporaryPath);
      JSON.parse(content.toString("utf8"));
      generated.push({
        filename,
        format: format.scout,
        sha256: createHash("sha256").update(content).digest("hex"),
        target: target.reference,
      });
    }
  }

  const manifest = {
    commit: run("git", ["rev-parse", "HEAD"]),
    dirty: dirtyState.length > 0,
    generatedAt: new Date().toISOString(),
    generator: DISPLAY_COMMAND,
    documents: generated,
  };
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = join(temporaryDirectory, "manifest.json");
  writeFileSync(manifestPath, manifestContent, "utf8");
  generated.push({
    filename: "manifest.json",
    format: "summyz-manifest",
    sha256: createHash("sha256").update(manifestContent).digest("hex"),
    target: manifest.commit,
  });
  const checksums = `${generated
    .map((document) => `${document.sha256}  ${document.filename}`)
    .join("\n")}\n`;
  writeFileSync(join(temporaryDirectory, "SHA256SUMS"), checksums, "utf8");

  mkdirSync(outputDirectory, { recursive: true });
  for (const filename of [...generated.map((document) => document.filename), "SHA256SUMS"]) {
    copyFileSync(join(temporaryDirectory, basename(filename)), join(outputDirectory, filename));
  }
  process.stdout.write(`SBOM evidence written to ${outputDirectory}\n`);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
