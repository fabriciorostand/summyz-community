import { describe, expect, it } from "vitest";

import {
  analyzeSourceQuality,
  parseChangedLines,
  type SourceFile,
} from "../scripts/ci/source-quality.js";

describe("source quality analysis", () => {
  it("parses added lines from a repository-relative unified diff", () => {
    const changed = parseChangedLines(
      [
        "diff --git a/src/example.ts b/src/example.ts",
        "--- a/src/example.ts",
        "+++ b/src/example.ts",
        "@@ -2,2 +2,3 @@",
        " unchanged",
        "+added",
        " another",
        "diff --git a/services/faster-whisper/example.py b/services/faster-whisper/example.py",
        "--- /dev/null",
        "+++ b/services/faster-whisper/example.py",
        "@@ -0,0 +1,2 @@",
        "+first",
        "+second",
      ].join("\n"),
    );

    expect([...(changed.get("src/example.ts") ?? [])]).toEqual([3]);
    expect([...(changed.get("services/faster-whisper/example.py") ?? [])]).toEqual([1, 2]);
  });

  it("combines jscpd and lizard reports with changed source lines", () => {
    const files: readonly SourceFile[] = [
      {
        content: [
          "export function first(value: boolean) {",
          "  if (value) {",
          "    return 1;",
          "  }",
          "  return 0;",
          "}",
        ].join("\n"),
        language: "typescript",
        path: "src/first.ts",
      },
      {
        content: [
          "export function second(value: boolean) {",
          "  if (value) {",
          "    return 1;",
          "  }",
          "  return 0;",
          "}",
        ].join("\n"),
        language: "typescript",
        path: "web/src/second.ts",
      },
      {
        content: [
          "def choose(value):",
          "    # ignored comment",
          "    if value and value > 1:",
          "        return 1",
          "    return 0",
        ].join("\n"),
        language: "python",
        path: "services/faster-whisper/choose.py",
      },
    ];
    const changed = new Map([
      ["src/first.ts", new Set([2])],
      ["services/faster-whisper/choose.py", new Set([3])],
    ]);

    const result = analyzeSourceQuality({
      changedLines: changed,
      jscpdReport: JSON.stringify({
        duplicates: [
          {
            firstFile: { end: 5, name: "C:\\repo\\src\\first.ts", start: 2 },
            lines: 4,
            secondFile: { end: 5, name: "C:\\repo\\web\\src\\second.ts", start: 2 },
          },
        ],
        statistics: { total: { percentage: 2.5 } },
      }),
      lizardCsv: [
        '5,11,20,1,5,"first@1-5@src\\first.ts","src\\first.ts","first","first ( value )",1,5',
        '4,3,15,1,4,"choose@1-4@services/faster-whisper/choose.py","services/faster-whisper/choose.py","choose","choose ( value )",1,4',
      ].join("\n"),
      lizardXml: [
        '<measure type="File">',
        '<item name="src\\first.ts"><value>1</value><value>501</value><value>11</value><value>1</value></item>',
        '<item name="web\\src\\second.ts"><value>2</value><value>6</value><value>2</value><value>1</value></item>',
        '<item name="services/faster-whisper/choose.py"><value>3</value><value>4</value><value>3</value><value>1</value></item>',
        "</measure>",
      ].join(""),
      rootPath: "C:/repo",
      sourceFiles: files,
    });

    expect(result.modules).toEqual([
      { changed: true, path: "services/faster-whisper/choose.py", sloc: 4 },
      { changed: true, path: "src/first.ts", sloc: 501 },
      { changed: false, path: "web/src/second.ts", sloc: 6 },
    ]);
    expect(result.complexityFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ complexity: 11, name: "first", path: "src/first.ts" }),
        expect.objectContaining({
          complexity: 3,
          name: "choose",
          path: "services/faster-whisper/choose.py",
        }),
      ]),
    );
    expect(result.newMaxComplexity).toBe(11);
    expect(result.newComplexityViolations).toBe(1);
    expect(result.changedOversizedModuleCount).toBe(1);
    expect(result.duplicateGroups[0]?.lines).toBe(4);
    expect(result.repositoryDuplication).toBe(2.5);
    expect(result.newDuplication).toBe(50);
  });

  it("rejects malformed analyzer reports", () => {
    expect(() =>
      analyzeSourceQuality({
        changedLines: new Map(),
        jscpdReport: "{}",
        lizardCsv: "",
        lizardXml: '<measure type="File"></measure>',
        rootPath: "/repo",
        sourceFiles: [],
      }),
    ).toThrow(/jscpd/u);
  });

  it("excludes blank and comment-only changed lines from new duplication", () => {
    const result = analyzeSourceQuality({
      changedLines: new Map([["src/example.ts", new Set([1, 2, 3, 4, 5])]]),
      jscpdReport: JSON.stringify({
        duplicates: [
          {
            firstFile: { end: 5, name: "/repo/src/example.ts", start: 1 },
            lines: 5,
            secondFile: { end: 5, name: "/repo/src/copy.ts", start: 1 },
          },
        ],
        statistics: { total: { percentage: 1 } },
      }),
      lizardCsv: '1,1,1,0,1,"run@5-5@src/example.ts","src/example.ts","run","run",5,5',
      lizardXml:
        '<measure type="File"><item name="src/example.ts"><value>1</value><value>1</value></item></measure>',
      rootPath: "/repo",
      sourceFiles: [
        {
          content: "// comment\n\n/* block\ncomment */\nconst value = 1;",
          language: "typescript",
          path: "src/example.ts",
        },
      ],
    });

    expect(result.newDuplication).toBe(100);
  });
});
