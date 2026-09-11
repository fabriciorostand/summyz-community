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

  it("audits the Node.js lockfile without running dependency lifecycle scripts", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const securityJob = implementation.slice(
      implementation.indexOf("\n  security:"),
      implementation.indexOf("\n  tests:"),
    );
    const auditStep = securityJob.slice(
      securityJob.indexOf("- name: Audit Node.js runtime dependencies"),
      securityJob.indexOf("- name: Set up exact Python"),
    );

    expect(securityJob).toContain(`npm install --global "npm@\${NPM_VERSION}"`);
    expect(securityJob).not.toContain("npm ci");
    expect(auditStep).toContain("npm audit --package-lock-only --omit=optional --json");
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
    // lizard cannot parse JSX, so .tsx complexity is enforced by Biome and complexipy covers Python.
    expect(implementation).toContain("lizard -l typescript -l python");
    expect(implementation).not.toContain("-l tsx");
    expect(implementation).toContain("--output-format sarif");
    expect(implementation).toContain("reports/quality/complexipy.sarif");
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

  it("excludes test files from cognitive and cyclomatic complexity checks", async () => {
    const [biomeSource, implementation, webCiConfig] = await Promise.all([
      readFile(new URL("biome.json", root), "utf8"),
      readFile(new URL(".github/workflows/_ci.yml", root), "utf8"),
      readFile(new URL("web/vite.ci.config.ts", root), "utf8"),
    ]);
    const biomeConfig: unknown = JSON.parse(biomeSource);

    expect(biomeConfig).toMatchObject({
      overrides: [
        {
          includes: [
            "tests/**",
            "**/tests/**",
            "**/*.test.ts",
            "**/*.test.tsx",
            "**/*.spec.ts",
            "**/*.spec.tsx",
            "**/test_*.py",
          ],
          linter: {
            rules: {
              complexity: {
                noExcessiveCognitiveComplexity: "off",
              },
            },
          },
        },
      ],
    });
    expect(implementation).toContain("complexipy services/faster-whisper");
    expect(implementation).toContain('--exclude "test_*.py"');
    expect(implementation.match(/-x "\*test\*" -x "\*spec\*"/gu)).toHaveLength(2);
    expect(webCiConfig).toContain('"src/tests/test-utils.tsx"');
    expect(webCiConfig).not.toContain('"src/test-utils.tsx"');
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

  it("preflights CUDA packages early and builds the target after reclaiming storage", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const preflightIndex = implementation.indexOf("- name: Preflight NVIDIA system packages");
    const cudaBuildIndex = implementation.indexOf("- name: Build NVIDIA packaging target");
    const botBuildIndex = implementation.indexOf("- name: Build bot image");
    const imagePolicyIndex = implementation.indexOf(
      "- name: Enforce fixable HIGH/CRITICAL image vulnerabilities",
    );
    const storageCleanupIndex = implementation.indexOf(
      "- name: Reclaim Docker storage before CUDA packaging",
    );
    const preflight = implementation.slice(
      preflightIndex,
      implementation.indexOf("- name:", preflightIndex + 1),
    );
    const cudaBuild = implementation.slice(
      cudaBuildIndex,
      implementation.indexOf("- name:", cudaBuildIndex + 1),
    );

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(preflightIndex).toBeLessThan(botBuildIndex);
    expect(preflight).toContain("repository_urls");
    expect(preflight).toContain("https://archive.ubuntu.com/ubuntu/dists/noble/InRelease");
    expect(preflight).toContain(
      "https://security.ubuntu.com/ubuntu/dists/noble-security/InRelease",
    );
    expect(preflight).toContain(`echo "Checking NVIDIA package repository: \${repository_url}"`);
    expect(preflight).toContain("--head");
    expect(preflight).toContain("--retry 5");
    expect(preflight).toContain("--retry-all-errors");
    expect(preflight).toContain("--retry-max-time 180");
    expect(preflight).toContain("--connect-timeout 15");
    expect(preflight).toContain("--max-time 60");
    expect(storageCleanupIndex).toBeGreaterThan(imagePolicyIndex);
    expect(cudaBuildIndex).toBeGreaterThan(storageCleanupIndex);
    expect(cudaBuild).toContain("load: false");
    expect(cudaBuild).not.toContain("load: true");
  });

  it("installs current CUDA system packages while bounding official archive failures", async () => {
    const dockerfile = await readFile(new URL("services/faster-whisper/Dockerfile", root), "utf8");
    const cudaSetup = dockerfile.slice(
      dockerfile.indexOf("FROM nvidia/cuda:"),
      dockerfile.indexOf("WORKDIR /service", dockerfile.indexOf("FROM nvidia/cuda:")),
    );

    expect(cudaSetup).not.toContain("UBUNTU_LIBOPUS_VERSION");
    expect(cudaSetup).not.toContain("UBUNTU_PYTHON_VERSION");
    expect(cudaSetup).not.toContain("UBUNTU_PYTHON_PIP_VERSION");
    expect(cudaSetup).not.toContain("UBUNTU_PYTHON_312_VENV_VERSION");
    expect(cudaSetup).toContain("libopus0 \\");
    expect(cudaSetup).toContain("python3 \\");
    expect(cudaSetup).toContain("python3-pip \\");
    expect(cudaSetup).toContain("python3-venv;");
    expect(cudaSetup).toContain("https://archive.ubuntu.com/ubuntu/");
    expect(cudaSetup).toContain("https://security.ubuntu.com/ubuntu/");
    expect(cudaSetup).toContain("Acquire::Retries=5");
    expect(cudaSetup).toContain("Acquire::http::Timeout=60");
    expect(cudaSetup).toContain("Acquire::https::Timeout=60");
    expect(cudaSetup).toContain("APT::Update::Error-Mode=any");
    expect(cudaSetup).not.toContain("snapshot.ubuntu.com");
  });

  it("reclaims duplicated build storage before runtime validation and smoke tests", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const runtimeJob = implementation.slice(implementation.indexOf("\n  runtime:"));
    const smokeBuildIndex = runtimeJob.indexOf("- name: Build smoke-test image");
    const storageCleanupIndex = runtimeJob.indexOf(
      "- name: Reclaim build storage before runtime validation",
    );
    const validationIndex = runtimeJob.indexOf(
      "- name: Validate image users, versions, and Compose overlays",
    );
    const storageCleanup = runtimeJob.slice(storageCleanupIndex, validationIndex);

    expect(storageCleanupIndex).toBeGreaterThan(smokeBuildIndex);
    expect(storageCleanupIndex).toBeLessThan(validationIndex);
    expect(storageCleanup).toContain("docker buildx prune --all --force");
    expect(storageCleanup).toContain("docker image prune --force");
  });

  it("makes the restored Whisper cache writable by the non-root runtime user", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const runtimeJob = implementation.slice(implementation.indexOf("\n  runtime:"));
    const restoreIndex = runtimeJob.indexOf("- name: Restore immutable local-model cache");
    const permissionsIndex = runtimeJob.indexOf("- name: Prepare local-model cache permissions");
    const smokeIndex = runtimeJob.indexOf("- name: Run real CPU local-AI smoke test");
    const permissionsStep = runtimeJob.slice(permissionsIndex, smokeIndex);

    expect(permissionsIndex).toBeGreaterThan(restoreIndex);
    expect(permissionsIndex).toBeLessThan(smokeIndex);
    expect(permissionsStep).toContain(`mkdir -p "\${CI_OLLAMA_CACHE}" "\${CI_WHISPER_CACHE}"`);
    expect(permissionsStep).toContain("summyz-community-faster-whisper:ci -u");
    expect(permissionsStep).toContain("summyz-community-faster-whisper:ci -g");
    expect(permissionsStep).toContain('--user "0:0"');
    expect(permissionsStep).toContain(`--volume "\${CI_WHISPER_CACHE}:/models"`);
    expect(permissionsStep).toContain("--entrypoint chown");
  });

  it("waits for local-AI healthchecks and prints diagnostics after smoke failures", async () => {
    const implementation = await readFile(new URL(".github/workflows/_ci.yml", root), "utf8");
    const runtimeJob = implementation.slice(implementation.indexOf("\n  runtime:"));
    const smokeIndex = runtimeJob.indexOf("- name: Run real CPU local-AI smoke test");
    const diagnosticsIndex = runtimeJob.indexOf("- name: Diagnose local-AI smoke-test failure");
    const stopIndex = runtimeJob.indexOf("- name: Stop local-AI services");
    const smokeStep = runtimeJob.slice(smokeIndex, diagnosticsIndex);
    const diagnosticsStep = runtimeJob.slice(diagnosticsIndex, stopIndex);

    expect(smokeStep).toContain("id: local_ai_smoke");
    expect(smokeStep).toContain("--wait --wait-timeout 180");
    expect(diagnosticsIndex).toBeGreaterThan(smokeIndex);
    expect(diagnosticsIndex).toBeLessThan(stopIndex);
    expect(diagnosticsStep).toContain("if: failure() && steps.local_ai_smoke.outcome == 'failure'");
    expect(diagnosticsStep).toContain("docker compose");
    expect(diagnosticsStep).toContain("ps --all");
    expect(diagnosticsStep).toContain("logs --no-color --timestamps ollama faster-whisper");
  });

  it("validates CPU execution through the Ollama processor report", async () => {
    const [implementation, smokeTest] = await Promise.all([
      readFile(new URL(".github/workflows/_ci.yml", root), "utf8"),
      readFile(new URL("tests/smoke/local-ai.smoke.test.ts", root), "utf8"),
    ]);
    const runtimeJob = implementation.slice(implementation.indexOf("\n  runtime:"));
    const smokeIndex = runtimeJob.indexOf("- name: Run real CPU local-AI smoke test");
    const diagnosticsIndex = runtimeJob.indexOf("- name: Diagnose local-AI smoke-test failure");
    const smokeStep = runtimeJob.slice(smokeIndex, diagnosticsIndex);

    expect(smokeStep).toContain("ollama ps");
    expect(smokeStep).toContain("100% CPU");
    expect(smokeTest).not.toContain("size_vram");
  });

  it("hides every GPU backend from the CPU smoke-test Ollama service", async () => {
    const overlay = await readFile(new URL(".github/ci/docker-compose.ci.yaml", root), "utf8");
    const ollamaSection = overlay.split("\n  ollama:")[1]?.split(/\n {2}\S/u)[0];

    expect(ollamaSection).toContain("OLLAMA_LLM_LIBRARY: cpu");
    expect(ollamaSection).toContain('OLLAMA_VULKAN: "false"');
    expect(ollamaSection).toContain('CUDA_VISIBLE_DEVICES: "-1"');
    expect(ollamaSection).toContain('HIP_VISIBLE_DEVICES: "-1"');
    expect(ollamaSection).toContain('ROCR_VISIBLE_DEVICES: "-1"');
    expect(ollamaSection).toContain('GGML_VK_VISIBLE_DEVICES: "-1"');
  });

  it("does not require a developer .env file for CI Compose operations", async () => {
    const [overlay, implementation] = await Promise.all([
      readFile(new URL(".github/ci/docker-compose.ci.yaml", root), "utf8"),
      readFile(new URL(".github/workflows/_ci.yml", root), "utf8"),
    ]);

    for (const service of ["bot", "dashboard"]) {
      const section = overlay.split(`\n  ${service}:`)[1]?.split(/\n {2}\S/u)[0];
      expect(section).toContain("env_file: !reset []");
    }

    const validationStep = implementation.slice(
      implementation.indexOf("- name: Validate image users, versions, and Compose overlays"),
      implementation.indexOf("- name: Restore immutable local-model cache"),
    );
    expect(validationStep.match(/-f \.github\/ci\/docker-compose\.ci\.yaml/gu)).toHaveLength(4);
    expect(validationStep).toContain("CI_OLLAMA_CACHE:");
    expect(validationStep).toContain("CI_WHISPER_CACHE:");
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
    expect(changedCoverageStep).toContain("docker run --rm");
    expect(changedCoverageStep).toContain('--user "$(id -u):$(id -g)"');
    expect(changedCoverageStep).toContain("summyz-community-tests:ci");
  });
});
