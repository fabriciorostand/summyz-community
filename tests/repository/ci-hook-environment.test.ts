import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("CI environment for Git hook validation", () => {
  it("installs Git in the test image without adding it to application runtime images", async () => {
    const dockerfile = await readFile(new URL("docker/Dockerfile", root), "utf8");
    const testStage = dockerfile.split("FROM build AS test")[1]?.split(/\nFROM /u)[0];
    const installation = /apt-get install\b([^&]*)/u.exec(testStage ?? "")?.[1];
    expect(installation).toMatch(/\bgit\b/u);
    const runtimeStages = dockerfile.split(" AS runtime-base")[1];
    expect(runtimeStages).toBeDefined();
    expect(runtimeStages).not.toMatch(/apt-get install\b[^&]*\bgit\b/u);
  });

  it("keeps cached Quality Gate analysis builds local without publishing images", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const analysis = workflow.split("\n  quality-gate-analysis:")[1]?.split("\n  quality-gate:")[0];
    expect(analysis).toBeDefined();
    const buildSteps = analysis
      ?.split(/\n {6}- name:/u)
      .filter((step) => step.includes("uses: docker/build-push-action@"));
    expect(buildSteps).toHaveLength(5);
    for (const step of buildSteps ?? []) {
      expect(step).toContain("load: true");
      expect(step).toContain("push: false");
    }
    expect(analysis).toContain("cache: npm");
    expect(analysis).not.toContain("zizmor: ignore[cache-poisoning]");
  });
});
