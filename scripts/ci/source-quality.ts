import { z } from "zod";

import type {
  ComplexityFinding,
  DuplicateGroup,
  DuplicateLocation,
  ModuleSize,
} from "./quality-gate.js";

export interface SourceFile {
  readonly content: string;
  readonly language: "python" | "typescript";
  readonly path: string;
}

export interface SourceQualityInput {
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
  readonly jscpdReport: string;
  readonly lizardCsv: string;
  readonly lizardXml: string;
  readonly rootPath: string;
  readonly sourceFiles: readonly SourceFile[];
}

export interface SourceQualityResult {
  readonly changedOversizedModuleCount: number;
  readonly complexityFindings: readonly ComplexityFinding[];
  readonly duplicateGroups: readonly DuplicateGroup[];
  readonly modules: readonly ModuleSize[];
  readonly newComplexityViolations: number;
  readonly newDuplication: number;
  readonly newMaxComplexity: number;
  readonly repositoryDuplication: number;
  readonly repositoryMaxComplexity: number;
}

interface ComplexityWithRange extends ComplexityFinding {
  readonly end: number;
}

const jscpdLocationSchema = z
  .object({
    end: z.number().int().positive(),
    name: z.string().min(1),
    start: z.number().int().positive(),
  })
  .passthrough();

const jscpdReportSchema = z
  .object({
    duplicates: z.array(
      z
        .object({
          firstFile: jscpdLocationSchema,
          lines: z.number().int().positive(),
          secondFile: jscpdLocationSchema,
        })
        .passthrough(),
    ),
    statistics: z
      .object({
        total: z
          .object({
            percentage: z.number().min(0).max(100),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const normalizeSlashes = (path: string): string =>
  path
    .replaceAll("\\", "/")
    .replace(/^\/\/\?\//u, "")
    .replace(/^\.\//u, "");

const normalizeReportedPath = (path: string, rootPath: string): string => {
  const normalized = normalizeSlashes(path);
  const root = normalizeSlashes(rootPath).replace(/\/$/u, "");
  if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
};

export const parseChangedLines = (diff: string): ReadonlyMap<string, ReadonlySet<number>> => {
  const changed = new Map<string, Set<number>>();
  let path: string | undefined;
  let newLine = 0;
  let inHunk = false;

  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("+++ ")) {
      const rawPath = line.slice(4).trim();
      path = rawPath === "/dev/null" ? undefined : normalizeSlashes(rawPath.replace(/^b\//u, ""));
      inHunk = false;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined || line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      const lines = changed.get(path) ?? new Set<number>();
      lines.add(newLine);
      changed.set(path, lines);
      newLine += 1;
      continue;
    }
    if (!line.startsWith("-")) newLine += 1;
  }
  return changed;
};

const parseCsvLine = (line: string): readonly string[] => {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("Invalid lizard CSV: unterminated quoted field.");
  fields.push(field);
  return fields;
};

const requiredInteger = (value: string | undefined, field: string): number => {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new Error(`Invalid lizard CSV ${field}.`);
  }
  return Number(value);
};

const parseComplexity = (csv: string, rootPath: string): readonly ComplexityWithRange[] =>
  csv
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const fields = parseCsvLine(line);
      if (fields.length !== 11 || !fields[6] || !fields[7]) {
        throw new Error("Invalid lizard CSV row.");
      }
      return {
        complexity: requiredInteger(fields[1], "cyclomatic complexity"),
        end: requiredInteger(fields[10], "end line"),
        line: requiredInteger(fields[9], "start line"),
        name: fields[7],
        path: normalizeReportedPath(fields[6], rootPath),
      };
    });

const decodeXmlAttribute = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const parseModules = (xml: string, rootPath: string): readonly ModuleSize[] => {
  const fileMeasure = xml.match(/<measure type="File">([\s\S]*?)<\/measure>/u)?.[1];
  if (fileMeasure === undefined) throw new Error("Invalid lizard XML: File measure is missing.");
  const modules: ModuleSize[] = [];
  for (const item of fileMeasure.matchAll(/<item name="([^"]+)">([\s\S]*?)<\/item>/gu)) {
    const rawPath = item[1];
    const body = item[2];
    if (rawPath === undefined || body === undefined) throw new Error("Invalid lizard XML item.");
    const values = [...body.matchAll(/<value>(\d+)<\/value>/gu)].map((match) => Number(match[1]));
    const sloc = values[1];
    if (sloc === undefined) throw new Error("Invalid lizard XML: module NCSS is missing.");
    modules.push({
      changed: false,
      path: normalizeReportedPath(decodeXmlAttribute(rawPath), rootPath),
      sloc,
    });
  }
  return modules;
};

const rounded = (value: number): number => Math.round(value * 100) / 100;

const intersects = (lines: ReadonlySet<number>, start: number, end: number): boolean => {
  for (const line of lines) {
    if (line >= start && line <= end) return true;
  }
  return false;
};

export const analyzeSourceQuality = (input: SourceQualityInput): SourceQualityResult => {
  let rawJscpd: unknown;
  try {
    rawJscpd = JSON.parse(input.jscpdReport);
  } catch (error) {
    throw new Error("Invalid jscpd JSON report.", { cause: error });
  }
  const parsedJscpd = jscpdReportSchema.safeParse(rawJscpd);
  if (!parsedJscpd.success) {
    throw new Error(`Invalid jscpd JSON report: ${parsedJscpd.error.message}`);
  }

  const duplicateGroups: DuplicateGroup[] = parsedJscpd.data.duplicates.map((duplicate) => ({
    lines: duplicate.lines,
    locations: [duplicate.firstFile, duplicate.secondFile].map(
      (location): DuplicateLocation => ({
        end: location.end,
        path: normalizeReportedPath(location.name, input.rootPath),
        start: location.start,
      }),
    ),
  }));
  const duplicatedLines = new Map<string, Set<number>>();
  for (const group of duplicateGroups) {
    for (const location of group.locations) {
      const lines = duplicatedLines.get(location.path) ?? new Set<number>();
      for (let line = location.start; line <= location.end; line += 1) lines.add(line);
      duplicatedLines.set(location.path, lines);
    }
  }

  const sourceCodeLines = new Map(
    input.sourceFiles.map((file) => [normalizeSlashes(file.path), codeLines(file)]),
  );
  let changedSourceLines = 0;
  let changedDuplicateLines = 0;
  for (const [path, lines] of input.changedLines) {
    const code = sourceCodeLines.get(path);
    if (code === undefined) continue;
    for (const line of lines) {
      if (!code.has(line)) continue;
      changedSourceLines += 1;
      if (duplicatedLines.get(path)?.has(line)) changedDuplicateLines += 1;
    }
  }

  const complexity = parseComplexity(input.lizardCsv, input.rootPath);
  const changedComplexity = complexity.filter((finding) =>
    intersects(
      input.changedLines.get(finding.path) ?? new Set<number>(),
      finding.line,
      finding.end,
    ),
  );
  const modules = parseModules(input.lizardXml, input.rootPath)
    .map((module) => ({
      ...module,
      changed: (input.changedLines.get(module.path)?.size ?? 0) > 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    changedOversizedModuleCount: modules.filter((module) => module.changed && module.sloc > 500)
      .length,
    complexityFindings: complexity.map(({ end: _end, ...finding }) => finding),
    duplicateGroups,
    modules,
    newComplexityViolations: changedComplexity.filter((finding) => finding.complexity > 10).length,
    newDuplication:
      changedSourceLines === 0 ? 0 : rounded((changedDuplicateLines / changedSourceLines) * 100),
    newMaxComplexity: Math.max(0, ...changedComplexity.map((finding) => finding.complexity)),
    repositoryDuplication: rounded(parsedJscpd.data.statistics.total.percentage),
    repositoryMaxComplexity: Math.max(0, ...complexity.map((finding) => finding.complexity)),
  };
};

const codeLines = (file: SourceFile): ReadonlySet<number> =>
  file.language === "python" ? pythonCodeLines(file.content) : typescriptCodeLines(file.content);

const pythonCodeLines = (content: string): ReadonlySet<number> => {
  const result = new Set<number>();
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith("#")) result.add(index + 1);
  }
  return result;
};

const typescriptCodeLines = (content: string): ReadonlySet<number> => {
  const result = new Set<number>();
  let inBlockComment = false;
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const analysis = analyzeTypescriptLine(line, inBlockComment);
    inBlockComment = analysis.inBlockComment;
    if (analysis.hasCode) result.add(index + 1);
  }
  return result;
};

const analyzeTypescriptLine = (
  line: string,
  startsInBlockComment: boolean,
): { hasCode: boolean; inBlockComment: boolean } => {
  let hasCode = false;
  let inBlockComment = startsInBlockComment;
  for (let index = 0; index < line.length; index += 1) {
    const current = line[index] ?? "";
    const next = line[index + 1] ?? "";
    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "/") break;
    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (!/\s/u.test(current)) hasCode = true;
  }
  return { hasCode, inBlockComment };
};
