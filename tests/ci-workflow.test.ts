import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("continuous integration contract", () => {
  it("routes PR cancellation and serialized main pushes through one implementation", async () => {
    const entry = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const prJob = entry.slice(entry.indexOf("\n  pr:"), entry.indexOf("\n  main:"));
    const mainJob = entry.slice(entry.indexOf("\n  main:"));

    expect(entry).toContain("pull_request:");
    expect(entry).toContain("push:");
    expect(entry).toContain("uses: ./.github/workflows/_ci.yml");
    expect(entry).toContain(["group: ci-pr-$", "{{ github.event.pull_request.number }}"].join(""));
    expect(entry).toContain("cancel-in-progress: true");
    expect(prJob).not.toContain("pull-requests: write");
    expect(mainJob).toContain("concurrency:");
    expect(mainJob).toContain("group: ci-main");
    expect(mainJob).toContain("queue: max");
    expect(mainJob).not.toContain("cancel-in-progress: true");
  });

  it("exposes every blocking producer and an aggregate gate without custom timeouts", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");

    for (const job of ["quality:", "security:", "tests:", "runtime:", "quality-gate:"]) {
      expect(implementation).toContain(`\n  ${job}`);
    }
    expect(implementation).toContain("runs-on: ubuntu-24.04");
    expect(implementation).not.toContain("timeout-minutes:");
    expect(implementation).toContain("postgres:18.4-alpine@sha256:");
    expect(implementation).toContain("--cov-fail-under=85");
    expect(implementation).toContain("SMOKE_WHISPER_REVISION:");
    expect(implementation).toContain("SMOKE_OLLAMA_DIGEST:");
    expect(implementation.match(/version: v0\.74\.0/gu)).toHaveLength(5);
  });

  it("pins every external action to a full commit SHA", async () => {
    const workflows = await Promise.all(
      [".github/workflows/ci.yml", ".github/workflows/_ci.yml"].map((path) =>
        readFile(new URL(path, root), "utf8"),
      ),
    );
    for (const line of workflows.join("\n").split("\n")) {
      const externalAction = line.match(/^\s*uses:\s+([^./][^@]+)@([^\s#]+)/u);
      if (externalAction === null) continue;
      expect(externalAction[2]).toMatch(/^[a-f0-9]{40}$/u);
    }
  });

  it("pins every Trivy scan to a patched action release", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const patchedTrivyAction =
      "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0";

    expect(implementation.split(patchedTrivyAction)).toHaveLength(6);
    expect(implementation).not.toContain(
      "aquasecurity/trivy-action@b6643a29fecd7f34b3597bc6acb0a98b03d33ff8",
    );
  });

  it("uses the exact Node.js and Python versions in project and images", async () => {
    const [packageJson, dockerfile, pythonDockerfile] = await Promise.all([
      readFile(new URL("package.json", root), "utf8"),
      readFile(new URL("Dockerfile", root), "utf8"),
      readFile(new URL("services/faster-whisper/Dockerfile", root), "utf8"),
    ]);

    expect(packageJson).toContain('"node": "22.23.2"');
    expect(packageJson).toContain('"packageManager": "npm@10.9.8"');
    expect(dockerfile).toContain("node:22.23.2-bookworm-slim@sha256:");
    expect(pythonDockerfile).toContain("python:3.12.14-slim-bookworm@sha256:");
  });

  it("uses the explicit Ubuntu release in every workflow", async () => {
    const workflows = await Promise.all(
      ["ci.yml", "_ci.yml", "individual-cla.yml"].map((name) =>
        readFile(new URL(`.github/workflows/${name}`, root), "utf8"),
      ),
    );

    expect(workflows.join("\n")).not.toContain("ubuntu-latest");
    expect(workflows.join("\n")).toContain("runs-on: ubuntu-24.04");
  });

  it("publishes the Scraper-style English Quality Gate from complete reports", async () => {
    const [entry, implementation] = await Promise.all([
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
      readFile(new URL(".github/workflows/_ci.yml", root), "utf8"),
    ]);

    expect(implementation).toContain("scripts/ci/quality-gate-cli.ts");
    expect(implementation).toContain("scripts/ci/source-quality-cli.ts");
    expect(implementation).toContain("./node_modules/.bin/jscpd");
    expect(implementation).toContain("lizard -l typescript -l tsx -l python");
    expect(implementation).toContain("quality-gate-baseline.json");
    expect(implementation).toContain("ci-summary.md");
    expect(implementation).not.toContain("pull-requests: write");
    expect(entry).toContain("quality-gate-comment:");
    expect(entry).toContain("pull-requests: write");
    expect(entry).toContain(
      'const fullBody = await readFile("quality-gate-comment/ci-summary.md", "utf8")',
    );
    expect(implementation).not.toContain("## Summyz Community CI");
  });

  it("reports every image vulnerability but only lets the aggregate policy block", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");

    for (const report of ["trivy-bot.json", "trivy-dashboard.json", "trivy-faster-whisper.json"]) {
      expect(implementation).toContain(`output: reports/runtime/${report}`);
    }
    expect(implementation.match(/format: json/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(implementation).toContain('exit-code: "0"');
    expect(implementation).toContain("output: reports/security/trivy-policy.sarif");
  });

  it("limits the blocking SARIF policy to configured severities", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const policyStep = implementation.slice(
      implementation.indexOf("- name: Enforce repository secret and misconfiguration policy"),
      implementation.indexOf("- name: Enforce fixable HIGH/CRITICAL dependency vulnerabilities"),
    );

    expect(policyStep).toContain("severity: HIGH,CRITICAL");
    expect(policyStep).toContain("limit-severities-for-sarif: true");
  });

  it("makes the shared reports root writable before test containers run", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const testsJob = implementation.slice(
      implementation.indexOf("\n  tests:"),
      implementation.indexOf("\n  runtime:"),
    );
    const initializationIndex = testsJob.indexOf("- name: Initialize test reports");
    const initializationStep = testsJob.slice(
      initializationIndex,
      testsJob.indexOf("- name:", initializationIndex + 1),
    );

    expect(initializationIndex).toBeGreaterThan(-1);
    expect(initializationIndex).toBeLessThan(
      testsJob.indexOf("- name: Run server tests with real PostgreSQL and coverage"),
    );
    expect(initializationStep).toContain("mkdir -p reports");
    expect(initializationStep).toContain("chmod 0777 reports");
  });

  it("validates CUDA packaging without loading the large image into the runner", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const cudaBuild = implementation.slice(
      implementation.indexOf("- name: Build NVIDIA packaging target"),
      implementation.indexOf("- name: Build smoke-test image"),
    );

    expect(cudaBuild).toContain("load: false");
    expect(cudaBuild).not.toContain("load: true");
  });

  it("does not require a developer .env file for CI Compose operations", async () => {
    const overlay = await readFile(new URL(".github/ci/docker-compose.ci.yaml", root), "utf8");

    for (const service of ["bot", "dashboard"]) {
      const section = overlay.split(`\n  ${service}:`)[1]?.split(/\n {2}\S/u)[0];
      expect(section).toContain("env_file: !reset []");
    }
  });

  it("enforces changed coverage once over the weighted server, dashboard, and Python total", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const changedCoverageStep = implementation.slice(
      implementation.indexOf("- name: Measure coverage on changed code"),
      implementation.indexOf("- name: Upload test and coverage reports"),
    );

    expect(changedCoverageStep).toContain("for component in server web python");
    expect(changedCoverageStep).not.toContain("--fail-under 85");
    expect(changedCoverageStep).toContain("scripts/ci/changed-coverage-cli.ts");
  });
});
