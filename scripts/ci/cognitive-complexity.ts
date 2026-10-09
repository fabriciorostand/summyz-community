import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { isFunction, isNode, type Node, VISITOR_KEYS } from "@babel/types";
import { z } from "zod";

import type { SourceFile } from "./source-quality.js";

export const cognitiveMeasurementSchema = z
  .object({
    maximum: z.number().int().nonnegative(),
    exact: z.boolean(),
  })
  .refine((value) => value.exact || value.maximum === 1);
export type CognitiveMeasurement = z.infer<typeof cognitiveMeasurementSchema>;
export const cognitiveReportSchema = z.object({
  repository: cognitiveMeasurementSchema,
  newCode: cognitiveMeasurementSchema,
});

interface FunctionRange {
  readonly path: string;
  readonly line: number;
  readonly end: number;
}

interface MeasuredFunction extends FunctionRange {
  readonly startColumn: number;
  readonly endColumn: number;
  complexity: number | undefined;
}

interface CognitiveInput {
  readonly biomeReport: unknown;
  readonly pythonReport: unknown;
  readonly rootPath: string;
  readonly sourceFiles: readonly SourceFile[];
  readonly pythonFunctions: readonly FunctionRange[];
  readonly changedLines: ReadonlyMap<string, ReadonlySet<number>>;
}

const cognitiveRules = new Set(["lint/complexity/noExcessiveCognitiveComplexity", "CC001"]);
const scannerReportSchema = z.object({
  runs: z
    .array(
      z.object({
        results: z
          .array(
            z.object({
              ruleId: z.string(),
              message: z.object({ text: z.string() }),
              locations: z
                .array(
                  z.object({
                    physicalLocation: z.object({
                      artifactLocation: z.object({ uri: z.string() }),
                      region: z.object({
                        startLine: z.number().int().positive(),
                        endLine: z.number().int().positive().optional(),
                        startColumn: z.number().int().positive().optional(),
                      }),
                    }),
                  }),
                )
                .nonempty(),
            }),
          )
          .optional(),
      }),
    )
    .nonempty(),
});

const normalizePath = (path: string, rootPath: string): string | undefined => {
  let value = path;
  try {
    if (path.startsWith("file:"))
      value = fileURLToPath(path, { windows: false }).replace(/^\/(?=[a-z]:\/)/iu, "");
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof URIError) return undefined;
    throw error;
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  const root = rootPath.replaceAll("\\", "/").replace(/\/$/u, "");
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
};

const functionRange = (
  node: Node,
  parent: Node | undefined,
  path: string,
): MeasuredFunction | undefined => {
  if (!isFunction(node) || !node.body || !node.loc) return undefined;
  const start =
    parent?.type === "VariableDeclarator" || parent?.type === "ObjectProperty"
      ? (parent.loc?.start ?? node.loc.start)
      : node.loc.start;
  return {
    path,
    line: start.line,
    startColumn: start.column + 1,
    end: node.loc.end.line,
    endColumn: node.loc.end.column + 1,
    complexity: undefined,
  };
};

const children = (node: Node): readonly Node[] =>
  (VISITOR_KEYS[node.type] ?? []).flatMap((key) => {
    const child: unknown = Reflect.get(node, key);
    if (Array.isArray(child)) return child.filter(isNode);
    return isNode(child) ? [child] : [];
  });

const typescriptFunctions = (file: SourceFile): MeasuredFunction[] => {
  const functions: MeasuredFunction[] = [];
  const ast = parse(file.content, {
    sourceType: "unambiguous",
    plugins: file.path.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  });
  const visit = (node: Node, parent?: Node): void => {
    const range = functionRange(node, parent, file.path);
    if (range) functions.push(range);
    for (const child of children(node)) visit(child, node);
  };
  visit(ast.program);
  return functions;
};

const contains = (range: MeasuredFunction, line: number, column: number): boolean =>
  line >= range.line &&
  line <= range.end &&
  (line !== range.line || column >= range.startColumn) &&
  (line !== range.end || column <= range.endColumn);

const locateFunction = (
  functions: readonly MeasuredFunction[],
  path: string,
  region: {
    readonly startLine: number;
    readonly startColumn?: number | undefined;
    readonly endLine?: number | undefined;
  },
  python: boolean,
): MeasuredFunction | undefined => {
  const matches = functions.filter(
    (range) => range.path === path && contains(range, region.startLine, region.startColumn ?? 1),
  );
  matches.sort((a, b) => a.end - a.line - (b.end - b.line) || b.startColumn - a.startColumn);
  if (matches.length > 0) return matches[0];
  // complexipy includes decorators in its location; lizard starts at the declaration.
  if (!python || region.endLine === undefined) return undefined;
  return functions
    .filter(
      (range) =>
        range.path === path && range.end === region.endLine && range.line > region.startLine,
    )
    .sort((a, b) => a.line - b.line)[0];
};

const assignMeasurements = (
  report: unknown,
  functions: MeasuredFunction[],
  root: string,
): boolean => {
  const parsed = scannerReportSchema.safeParse(report);
  if (!parsed.success) return false;
  for (const result of parsed.data.runs.flatMap((run) => run.results ?? [])) {
    if (!cognitiveRules.has(result.ruleId)) return false;
    const complexity = Number(result.message.text.match(/complexity of (\d+)/u)?.[1]);
    if (
      !Number.isInteger(complexity) ||
      complexity <= 1 ||
      !/(?:max: 1\b|maximum allowed complexity of 1\b)/u.test(result.message.text)
    )
      return false;
    const location = result.locations[0]?.physicalLocation;
    if (!location) return false;
    const path = normalizePath(location.artifactLocation.uri, root);
    if (path === undefined) return false;
    const match = locateFunction(functions, path, location.region, result.ruleId === "CC001");
    if (!match) return false;
    match.complexity = Math.max(match.complexity ?? 0, complexity);
  }
  return true;
};

const maximum = (functions: readonly MeasuredFunction[]): CognitiveMeasurement => {
  if (functions.length === 0) return { maximum: 0, exact: true };
  const measured = Math.max(1, ...functions.map((range) => range.complexity ?? 1));
  return { maximum: measured, exact: measured > 1 };
};

export const analyzeCognitiveComplexity = (
  input: CognitiveInput,
): z.infer<typeof cognitiveReportSchema> | undefined => {
  let typescript: MeasuredFunction[];
  try {
    typescript = input.sourceFiles
      .filter((file) => file.language === "typescript")
      .flatMap(typescriptFunctions);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  const python: MeasuredFunction[] = input.pythonFunctions.map((range) => ({
    ...range,
    startColumn: 1,
    endColumn: Number.MAX_SAFE_INTEGER,
    complexity: undefined,
  }));
  if (
    !assignMeasurements(input.biomeReport, typescript, input.rootPath) ||
    !assignMeasurements(input.pythonReport, python, input.rootPath)
  )
    return undefined;
  const functions = [...typescript, ...python];
  const changed = functions.filter((range) =>
    [...(input.changedLines.get(range.path) ?? [])].some(
      (line) => line >= range.line && line <= range.end,
    ),
  );
  return { repository: maximum(functions), newCode: maximum(changed) };
};
