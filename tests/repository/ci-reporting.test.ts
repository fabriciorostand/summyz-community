import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

const workflowUrl = new URL("../../.github/workflows/ci.yml", import.meta.url);
const workflowStep = (workflow: string, name: string): string => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

describe("CI reporting after infrastructure failures", () => {
  it("treats baseline lookup and download as optional and retries GitHub server failures", async () => {
    const workflow = await readFile(workflowUrl, "utf8");
    const lookup = workflowStep(workflow, "Locate the latest successful main baseline");
    expect(lookup).toContain("continue-on-error: true");
    expect(lookup).toContain("retries: 3");
    expect(workflowStep(workflow, "Download the main baseline")).toContain(
      "continue-on-error: true",
    );
  });

  it("still attempts analysis after earlier steps fail", async () => {
    const workflow = await readFile(workflowUrl, "utf8");
    expect(workflowStep(workflow, "Analyze the Quality Gate")).toContain(
      `if: \${{ !cancelled() }}`,
    );
  });

  const runComment = async (
    readError?: Error,
    fullBody = "<!-- summyz-community-quality-gate -->\n| Coverage | 90% |",
  ) => {
    const workflow = await readFile(workflowUrl, "utf8");
    const step = workflowStep(workflow, "Update the persistent internal pull-request comment");
    const script = step.split("          script: |\n")[1];
    if (!script) throw new Error("Missing comment script");
    const createComment = vi.fn().mockResolvedValue({});
    const updateComment = vi.fn().mockResolvedValue({});
    const warnings: string[] = [];
    await runInNewContext(`(async () => {\n${script}\n})()`, {
      require: () => ({
        readFile: async () => {
          if (readError) throw readError;
          return fullBody;
        },
      }),
      process: { env: { ANALYSIS_RESULT: "failure" } },
      core: { warning: (message: string) => warnings.push(message) },
      context: {
        serverUrl: "https://github.com",
        repo: { owner: "example", repo: "summyz" },
        runId: 123,
        issue: { number: 55 },
      },
      github: {
        paginate: vi.fn().mockResolvedValue([]),
        rest: { issues: { createComment, updateComment, listComments: vi.fn() } },
      },
    });
    return { createComment, updateComment, warnings };
  };

  it("keeps the original failure when no complete report was generated", async () => {
    const error = Object.assign(new Error("Report missing"), { code: "ENOENT" });
    await expect(runComment(error)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the complete metrics report when available", async () => {
    const fullBody = "<!-- summyz-community-quality-gate -->\n| Coverage | 90% |";
    const result = await runComment(undefined, fullBody);
    expect(result.createComment).toHaveBeenCalledWith(expect.objectContaining({ body: fullBody }));
  });

  it("propagates unexpected report read errors", async () => {
    await expect(
      runComment(Object.assign(new Error("Read denied"), { code: "EACCES" })),
    ).rejects.toMatchObject({ code: "EACCES" });
  });
});
