import { describe, expect, it } from "vitest";

import { analyzeCognitiveComplexity } from "../scripts/ci/cognitive-complexity.js";

const sarif = (complexity?: number, path = "src/example.ts", line = 1, column = 17) => ({
  runs: [
    {
      results:
        complexity === undefined
          ? []
          : [
              {
                ruleId: path.endsWith(".py")
                  ? "CC001"
                  : "lint/complexity/noExcessiveCognitiveComplexity",
                message: { text: `Excessive complexity of ${complexity} detected (max: 1).` },
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: path },
                      region: { startLine: line, startColumn: column },
                    },
                  },
                ],
              },
            ],
    },
  ],
});
const input = () => ({
  biomeReport: sarif(),
  pythonReport: sarif(),
  rootPath: "/repo",
  sourceFiles: [
    {
      path: "src/example.ts",
      language: "typescript" as const,
      content: "export function choose(value: boolean) {\n  if (value) return 1;\n  return 0;\n}",
    },
  ],
  pythonFunctions: [],
  changedLines: new Map([["src/example.ts", new Set([2])]]),
});

describe("cognitive complexity measurements", () => {
  it("leaves malformed file locations unavailable without aborting the quality report", () => {
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        biomeReport: sarif(5, "file://invalid-host/example.ts"),
      }),
    ).toBeUndefined();
  });
  it("parses TypeScript type assertions without treating them as JSX", () => {
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        sourceFiles: [
          {
            path: "src/example.ts",
            language: "typescript",
            content: "export const choose = () => { const value = <number>1; return value; };",
          },
        ],
        changedLines: new Map([["src/example.ts", new Set([1])]]),
      }),
    ).toEqual({ repository: { maximum: 1, exact: false }, newCode: { maximum: 1, exact: false } });
  });
  it("reports the measured maximum below the approval threshold", () => {
    expect(analyzeCognitiveComplexity({ ...input(), biomeReport: sarif(12) })).toEqual({
      repository: { maximum: 12, exact: true },
      newCode: { maximum: 12, exact: true },
    });
  });

  it("does not invent zero when Biome only establishes an upper bound of one", () => {
    expect(analyzeCognitiveComplexity(input())).toEqual({
      repository: { maximum: 1, exact: false },
      newCode: { maximum: 1, exact: false },
    });
  });

  it("reports exact zero for a diff without any changed functions", () => {
    expect(
      analyzeCognitiveComplexity({ ...input(), changedLines: new Map(), biomeReport: sarif(15) }),
    ).toEqual({
      repository: { maximum: 15, exact: true },
      newCode: { maximum: 0, exact: true },
    });
  });

  it("matches an anonymous TSX function and changes inside its body", () => {
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        sourceFiles: [
          {
            path: "web/src/example.tsx",
            language: "typescript",
            content:
              "export const View = () => {\n if (true) return <div />;\n return <span />;\n};",
          },
        ],
        biomeReport: sarif(5, "file:///repo/web/src/example.tsx", 1, 24),
        changedLines: new Map([["web/src/example.tsx", new Set([2])]]),
      }),
    ).toEqual({ repository: { maximum: 5, exact: true }, newCode: { maximum: 5, exact: true } });
  });

  it("selects the innermost function when functions share a declaration line", () => {
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        sourceFiles: [
          {
            path: "src/example.ts",
            language: "typescript",
            content:
              "export function outer() { const inner = () => {\n if (true) return 1;\n};\n return 0;\n}",
          },
        ],
        biomeReport: sarif(6, "src/example.ts", 1, 43),
        changedLines: new Map([["src/example.ts", new Set([4])]]),
      }),
    ).toEqual({ repository: { maximum: 6, exact: true }, newCode: { maximum: 1, exact: false } });
  });

  it("combines Python and TypeScript measurements without counting the measurement as an issue", () => {
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        pythonReport: sarif(7, "/repo/services/faster-whisper/server.py", 3, 1),
        pythonFunctions: [{ path: "services/faster-whisper/server.py", line: 3, end: 9 }],
        changedLines: new Map([["services/faster-whisper/server.py", new Set([6])]]),
      }),
    ).toEqual({ repository: { maximum: 7, exact: true }, newCode: { maximum: 7, exact: true } });
  });

  it("leaves measurements unavailable for missing, malformed, or unmappable scanner evidence", () => {
    expect(analyzeCognitiveComplexity({ ...input(), pythonReport: undefined })).toBeUndefined();
    expect(
      analyzeCognitiveComplexity({ ...input(), biomeReport: { token: "must-never-log" } }),
    ).toBeUndefined();
    expect(
      analyzeCognitiveComplexity({ ...input(), biomeReport: sarif(5, "src/absent.ts") }),
    ).toBeUndefined();
  });

  it("matches Python diagnostics that start at a decorator instead of the function declaration", () => {
    const report = {
      runs: [
        {
          results: [
            {
              ruleId: "CC001",
              message: {
                text: "Function 'choose' has a cognitive complexity of 3, which exceeds the maximum allowed complexity of 1.",
              },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "services/faster-whisper/server.py" },
                    region: { startLine: 2, endLine: 9 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      analyzeCognitiveComplexity({
        ...input(),
        pythonReport: report,
        pythonFunctions: [
          { path: "services/faster-whisper/server.py", line: 3, end: 9 },
          { path: "services/faster-whisper/server.py", line: 5, end: 9 },
        ],
        changedLines: new Map([["services/faster-whisper/server.py", new Set([4])]]),
      }),
    ).toEqual({ repository: { maximum: 3, exact: true }, newCode: { maximum: 3, exact: true } });
  });

  it("does not accept an approval-threshold report as a measurement at threshold one", () => {
    const report = sarif(18);
    const result = report.runs[0]?.results[0];
    if (result) result.message.text = "Excessive complexity of 18 detected (max: 15).";
    expect(analyzeCognitiveComplexity({ ...input(), biomeReport: report })).toBeUndefined();
  });
});
