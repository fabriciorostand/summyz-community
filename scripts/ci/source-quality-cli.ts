import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

import { analyzeSourceQuality, parseChangedLines, type SourceFile } from "./source-quality.js";

const root = resolve(process.cwd());

const collectFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
};

const isProductionSource = (path: string): boolean => {
  const normalized = relative(root, path).replaceAll("\\", "/");
  if (/\.(?:test|spec)\.(?:ts|tsx)$/u.test(normalized) || /\btest_[^/]+\.py$/u.test(normalized)) {
    return false;
  }
  return (
    (/^src\/.*\.ts$/u.test(normalized) && !normalized.endsWith(".d.ts")) ||
    (/^web\/src\/.*\.(?:ts|tsx)$/u.test(normalized) && !normalized.endsWith(".d.ts")) ||
    /^services\/faster-whisper\/[^/]+\.py$/u.test(normalized)
  );
};

const toSourceFile = async (path: string): Promise<SourceFile> => ({
  content: await readFile(path, "utf8"),
  language: extname(path) === ".py" ? "python" : "typescript",
  path: relative(root, path).replaceAll("\\", "/"),
});

const readCognitiveReport = async (path: string | undefined): Promise<unknown> => {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(resolve(root, path), "utf8"));
  } catch (error: unknown) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      console.error(
        JSON.stringify({
          event: "cognitive_report_unavailable",
          message: "Cognitive measurement report unavailable.",
        }),
      );
      return undefined;
    }
    throw error;
  }
};

const main = async (): Promise<void> => {
  const [diffPath, jscpdPath, lizardCsvPath, lizardXmlPath, outputPath, biomePath, pythonPath] =
    process.argv.slice(2);
  if (!diffPath || !jscpdPath || !lizardCsvPath || !lizardXmlPath || !outputPath) {
    throw new Error(
      "Usage: source-quality-cli <repository.diff> <jscpd.json> <lizard.csv> <lizard.xml> <output.json> [biome-cognitive.sarif complexipy-cognitive.sarif]",
    );
  }
  const candidateDirectories = [
    resolve(root, "src"),
    resolve(root, "web/src"),
    resolve(root, "services/faster-whisper"),
  ];
  const candidates = (await Promise.all(candidateDirectories.map(collectFiles))).flat();
  const sourceFiles = await Promise.all(candidates.filter(isProductionSource).map(toSourceFile));
  const result = analyzeSourceQuality({
    ...(biomePath || pythonPath
      ? {
          cognitiveReports: {
            biome: await readCognitiveReport(biomePath),
            python: await readCognitiveReport(pythonPath),
          },
        }
      : {}),
    changedLines: parseChangedLines(await readFile(resolve(root, diffPath), "utf8")),
    jscpdReport: await readFile(resolve(root, jscpdPath), "utf8"),
    lizardCsv: await readFile(resolve(root, lizardCsvPath), "utf8"),
    lizardXml: await readFile(resolve(root, lizardXmlPath), "utf8"),
    rootPath: root,
    sourceFiles,
  });
  const absoluteOutput = resolve(root, outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
};

await main();
