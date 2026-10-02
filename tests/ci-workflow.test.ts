import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("continuous integration contract", () => {
  it("scans the complete history with redacted output and the repository's finding-specific ignore file", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const step = workflow.slice(
      workflow.indexOf("- name: Scan the complete history for secrets"),
      workflow.indexOf("- name: Report every repository vulnerability"),
    );
    expect(step).toContain("detect --source=/repo --redact");
    expect(step).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(step).not.toContain("--exit-code=0");
    const fingerprints = (await readFile(new URL(".gitleaksignore", root), "utf8"))
      .split("\n")
      .filter((line) => line.length > 0 && !line.startsWith("#"));
    expect(fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of fingerprints)
      expect(fingerprint).toMatch(/^[a-f0-9]{40}:[^:*]+:[a-z0-9-]+:\d+$/u);
  });
  it("shows the individual CLA check as CLA / Individual", async () => {
    const workflow = await readFile(new URL(".github/workflows/individual-cla.yml", root), "utf8");

    expect(workflow).toMatch(/^name: CLA$/mu);
    expect(workflow).toMatch(/^ {2}validate-individual-cla:\n {4}name: Individual$/mu);
  });

  it("runs one workflow for PRs and post-merge main while cancelling only superseded PRs", async () => {
    const entry = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const workflowFiles = await readdir(new URL(".github/workflows/", root));

    expect(entry).toContain("pull_request:");
    expect(entry).toContain("push:");
    expect(entry).toContain("branches: [main]");
    expect(entry).toContain(
      `group: \${{ github.workflow }}-\${{ github.event_name == 'pull_request' && github.ref || github.run_id }}`,
    );
    expect(entry).toContain(`cancel-in-progress: \${{ github.event_name == 'pull_request' }}`);
    expect(entry).not.toContain("queue: max");
    expect(entry).not.toContain("uses: ./.github/workflows/_ci.yml");
    expect(entry).not.toMatch(/\n {2}(?:pr|main):/u);
    expect(workflowFiles).not.toContain("_ci.yml");
  });

  it("exposes the six exact CI checks with analysis before the final gate", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");

    const jobs = [
      ["quality", "Quality"],
      ["quality-gate-analysis", "Quality Gate / Analysis"],
      ["quality-gate", "Quality Gate"],
      ["runtime", "Runtime / Images"],
      ["security", "Security"],
      ["tests", "Tests"],
    ] as const;
    for (const [id, name] of jobs) {
      expect(implementation).toContain(`\n  ${id}:\n    name: ${name}\n`);
    }
    expect(implementation.split("\njobs:\n")[1]?.match(/^ {2}[a-z][a-z-]+:$/gmu)).toHaveLength(
      jobs.length,
    );
    expect(implementation).toContain("needs: [quality, security, tests, runtime]");
    expect(implementation).toContain("needs: quality-gate-analysis");
    expect(implementation.match(/if: \$\{\{ !cancelled\(\) \}\}/gu)).toHaveLength(2);
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
      [".github/workflows/ci.yml", ".github/workflows/individual-cla.yml"].map((path) =>
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
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
      readFile(new URL("docker/Dockerfile", root), "utf8"),
      readFile(new URL("services/faster-whisper/Dockerfile", root), "utf8"),
    ]);

    expect(packageJson).toContain('"node": "22.23.2"');
    expect(packageJson).toContain('"packageManager": "npm@10.9.8"');
    expect(dockerfile).toContain("node:22.23.2-bookworm-slim@sha256:");
    expect(pythonDockerfile).toContain("python:3.12.14-slim-bookworm@sha256:");
  });

  it("builds every application target from the centralized Dockerfile", async () => {
    const [implementation, qualityGateCli] = await Promise.all([
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
      readFile(new URL("scripts/ci/quality-gate-cli.ts", root), "utf8"),
    ]);

    expect(implementation.match(/file: docker\/Dockerfile/gu)).toHaveLength(4);
    expect(qualityGateCli.match(/return "docker\/Dockerfile"/gu)).toHaveLength(2);
  });

  it("audits the Node.js lockfile without running dependency lifecycle scripts", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
      ["ci.yml", "individual-cla.yml"].map((name) =>
        readFile(new URL(`.github/workflows/${name}`, root), "utf8"),
      ),
    );

    expect(workflows.join("\n")).not.toContain("ubuntu-latest");
    expect(workflows.join("\n")).toContain("runs-on: ubuntu-24.04");
  });

  it("keeps analysis read-only and publishes the PR comment from the final gate", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const analysis = implementation.slice(
      implementation.indexOf("\n  quality-gate-analysis:"),
      implementation.indexOf("\n  quality-gate:"),
    );
    const gate = implementation.slice(implementation.indexOf("\n  quality-gate:"));

    expect(analysis).toContain("scripts/ci/quality-gate-cli.ts");
    expect(implementation).toContain("scripts/ci/source-quality-cli.ts");
    expect(implementation).toContain("./node_modules/.bin/jscpd");
    // lizard cannot parse JSX, so .tsx complexity is enforced by Biome and complexipy covers Python.
    expect(implementation).toContain("lizard -l typescript -l python");
    expect(implementation).not.toContain("-l tsx");
    expect(implementation).toContain("--output-format sarif");
    expect(implementation).toContain("artifacts/reports/quality/complexipy.sarif");
    expect(implementation).toContain("quality-gate-baseline.json");
    expect(implementation).toContain("ci-summary.md");
    expect(analysis).not.toContain("pull-requests: write");
    expect(analysis).toContain("ci-quality-gate-baseline");
    expect(gate).toContain("pull-requests: write");
    expect(gate).not.toContain("actions/checkout@");
    expect(gate).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(gate).toContain(
      'const fullBody = await readFile("quality-gate-report/ci-summary.md", "utf8")',
    );
    expect(gate).toContain("jq --exit-status '.passed == true'");
    expect(implementation).not.toContain("## Summyz Community CI");
  });

  it("excludes test files from cognitive and cyclomatic complexity checks", async () => {
    const [biomeSource, implementation, webCiConfig] = await Promise.all([
      readFile(new URL("biome.json", root), "utf8"),
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
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
    expect(implementation).toContain("--cache-dir .cache/complexipy");
    expect(implementation).toContain('--exclude "test_*.py"');
    expect(implementation.match(/-x "\*test\*" -x "\*spec\*"/gu)).toHaveLength(2);
    expect(webCiConfig).toContain('"src/tests/test-utils.tsx"');
    expect(webCiConfig).not.toContain('"src/test-utils.tsx"');
  });

  it("reports every image vulnerability but only lets the aggregate policy block", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");

    for (const report of ["trivy-bot.json", "trivy-dashboard.json", "trivy-faster-whisper.json"]) {
      expect(implementation).toContain(`output: artifacts/reports/runtime/${report}`);
    }
    expect(implementation.match(/format: json/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(implementation).toContain('exit-code: "0"');
    expect(implementation).toContain("output: artifacts/reports/security/trivy-policy.sarif");
  });

  it("limits the blocking SARIF policy to configured severities", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const policyStep = implementation.slice(
      implementation.indexOf("- name: Enforce repository secret and misconfiguration policy"),
      implementation.indexOf("- name: Enforce fixable HIGH/CRITICAL dependency vulnerabilities"),
    );

    expect(policyStep).toContain("severity: HIGH,CRITICAL");
    expect(policyStep).toContain("limit-severities-for-sarif: true");
  });

  it("makes the shared reports root writable before test containers run", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
    expect(initializationStep).toContain("mkdir -p artifacts/reports");
    expect(initializationStep).toContain("chmod 0777 artifacts/reports");
  });

  it("preflights CUDA packages early and builds the target after reclaiming storage", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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

  it("preserves the bot BuildKit cache when building the dashboard", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const botBuild = workflow.slice(
      workflow.indexOf("- name: Build bot image"),
      workflow.indexOf("- name: Build dashboard image"),
    );
    const dashboardBuild = workflow.slice(
      workflow.indexOf("- name: Build dashboard image"),
      workflow.indexOf("- name: Build CPU transcription image"),
    );

    expect(botBuild).toContain("'type=gha,mode=max,scope=summyz-runtime,ignore-error=true'");
    expect(dashboardBuild).toContain("cache-from: type=gha,scope=summyz-runtime");
    expect(dashboardBuild).not.toContain("cache-to:");
  });

  it("writes build and model caches only from pushes to main", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const cacheWrites = workflow.match(/^ +cache-to: .+$/gmu) ?? [];
    const runtimeJob = workflow.slice(workflow.indexOf("\n  runtime:"));
    const saveStep = runtimeJob.slice(
      runtimeJob.indexOf("- name: Save verified local-model cache"),
      runtimeJob.indexOf("- name: Initialize runtime reports"),
    );

    expect(cacheWrites).toHaveLength(5);
    for (const cacheWrite of cacheWrites) {
      expect(cacheWrite).toMatch(
        /^ +cache-to: \$\{\{ github\.event_name == 'push' && 'type=gha,mode=max,scope=[a-z-]+,ignore-error=true' \|\| '' \}\}$/u,
      );
    }
    expect(saveStep).toContain("github.event_name == 'push'");
  });

  it("reuses the tests image cache for the smoke image without writing it twice", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const runtimeJob = workflow.slice(workflow.indexOf("\n  runtime:"));
    const smokeBuild = runtimeJob.slice(
      runtimeJob.indexOf("- name: Build smoke-test image"),
      runtimeJob.indexOf("- name: Reclaim build storage before runtime validation"),
    );

    expect(smokeBuild).toContain("cache-from: type=gha,scope=summyz-node-tests");
    expect(smokeBuild).not.toContain("cache-to:");
  });

  it("runs the CI test suites on every runner core", async () => {
    const [serverCiConfig, webCiConfig] = await Promise.all([
      readFile(new URL("vitest.ci.config.ts", root), "utf8"),
      readFile(new URL("web/vite.ci.config.ts", root), "utf8"),
    ]);

    expect(serverCiConfig).toContain('maxWorkers: "100%"');
    expect(webCiConfig).toContain('maxWorkers: "100%"');
  });

  it("skips the local-AI smoke test and CUDA packaging on unrelated pull requests", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const runtimeJob = workflow.slice(workflow.indexOf("\n  runtime:"));
    const stepOf = (name: string): string => {
      const start = runtimeJob.indexOf(`- name: ${name}`);
      expect(start).toBeGreaterThan(-1);
      return runtimeJob.slice(start, runtimeJob.indexOf("- name:", start + 1));
    };
    const detection = stepOf("Detect changes that need the local-AI smoke test or CUDA packaging");
    const localAiCondition = "steps.changes.outputs.local-ai == 'true'";
    const cudaCondition = "steps.changes.outputs.cuda == 'true'";

    expect(runtimeJob.indexOf("- name: Detect changes")).toBeLessThan(
      runtimeJob.indexOf("- name: Preflight NVIDIA system packages"),
    );
    expect(detection).toContain("id: changes");
    expect(detection).toContain(`if [[ "\${EVENT_NAME}" != "pull_request" ]]`);
    expect(detection).toContain(`git diff --name-only "\${BASE_SHA}...HEAD"`);
    for (const path of [
      "services/faster-whisper/",
      "docker/",
      "requirements/",
      "src/models/",
      "tests/smoke/",
      "compose",
      "package-lock",
    ]) {
      expect(detection).toContain(path);
    }
    for (const name of [
      "Start pulling the local-AI images in the background",
      "Build smoke-test image",
      "Reclaim build storage before runtime validation",
      "Restore immutable local-model cache",
      "Prepare local-model cache permissions",
      "Wait for the local-AI images",
      "Run real CPU local-AI smoke test",
      "Stop local-AI services",
    ]) {
      expect(stepOf(name)).toContain(localAiCondition);
    }
    for (const name of [
      "Preflight NVIDIA system packages",
      "Reclaim Docker storage before CUDA packaging",
      "Build NVIDIA packaging target",
    ]) {
      expect(stepOf(name)).toContain(cudaCondition);
    }
  });

  it("pulls the local-AI images while the application images build", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const runtimeJob = workflow.slice(workflow.indexOf("\n  runtime:"));
    const pullIndex = runtimeJob.indexOf(
      "- name: Start pulling the local-AI images in the background",
    );
    const waitIndex = runtimeJob.indexOf("- name: Wait for the local-AI images");
    const pullStep = runtimeJob.slice(pullIndex, runtimeJob.indexOf("- name:", pullIndex + 1));
    const waitStep = runtimeJob.slice(waitIndex, runtimeJob.indexOf("- name:", waitIndex + 1));

    expect(pullIndex).toBeGreaterThan(-1);
    expect(pullIndex).toBeLessThan(runtimeJob.indexOf("- name: Build bot image"));
    expect(pullStep).toContain("pull --quiet ollama");
    expect(pullStep).toContain("local-ai-pull.status");
    expect(waitIndex).toBeGreaterThan(pullIndex);
    expect(waitIndex).toBeLessThan(runtimeJob.indexOf("- name: Run real CPU local-AI smoke test"));
    expect(waitStep).toContain("local-ai-pull.log");
    expect(waitStep).toContain('= "0"');
  });

  it("caches only local model artifacts after a successful smoke test", async () => {
    const workflow = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
    const runtimeJob = workflow.slice(workflow.indexOf("\n  runtime:"));
    const restoreIndex = runtimeJob.indexOf("- name: Restore immutable local-model cache");
    const smokeIndex = runtimeJob.indexOf("- name: Run real CPU local-AI smoke test");
    const stopIndex = runtimeJob.indexOf("- name: Stop local-AI services");
    const prepareIndex = runtimeJob.indexOf("- name: Prepare verified local-model cache");
    const saveIndex = runtimeJob.indexOf("- name: Save verified local-model cache");
    const reportIndex = runtimeJob.indexOf("- name: Initialize runtime reports");
    const restoreStep = runtimeJob.slice(restoreIndex, smokeIndex);
    const prepareStep = runtimeJob.slice(prepareIndex, saveIndex);
    const saveStep = runtimeJob.slice(saveIndex, reportIndex);
    const allowedPaths =
      "with:\n          path: |\n            .cache/ci/ollama/models\n            .cache/ci/faster-whisper/managed\n          key:";

    expect(restoreStep).toContain("uses: actions/cache/restore@");
    expect(restoreStep).toContain(allowedPaths);
    expect(restoreStep).not.toContain("path: .cache/ci\n");
    expect(prepareIndex).toBeGreaterThan(stopIndex);
    expect(saveIndex).toBeGreaterThan(prepareIndex);
    expect(saveIndex).toBeLessThan(reportIndex);
    expect(prepareStep).toContain("chown --recursive");
    expect(prepareStep).toContain("steps.local_ai_smoke.outcome == 'success'");
    expect(prepareStep).toContain("steps.local_model_cache.outputs.cache-hit != 'true'");
    expect(saveStep).toContain("uses: actions/cache/save@");
    expect(saveStep).toContain(allowedPaths);
    expect(saveStep).not.toContain("path: .cache/ci\n");
    expect(saveStep).toContain("steps.local_ai_smoke.outcome == 'success'");
    expect(saveStep).toContain("steps.local_model_cache.outputs.cache-hit != 'true'");
    expect(saveStep).toContain("steps.local_model_cache.outputs.cache-primary-key");
    expect(saveStep).not.toContain("id_ed25519");
  });

  it("makes the restored Whisper cache writable by the non-root runtime user", async () => {
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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

  it("validates CPU execution through the Ollama compute backend logs", async () => {
    const [implementation, smokeTest] = await Promise.all([
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
      readFile(new URL("tests/smoke/local-ai.smoke.test.ts", root), "utf8"),
    ]);
    const runtimeJob = implementation.slice(implementation.indexOf("\n  runtime:"));
    const smokeIndex = runtimeJob.indexOf("- name: Run real CPU local-AI smoke test");
    const diagnosticsIndex = runtimeJob.indexOf("- name: Diagnose local-AI smoke-test failure");
    const smokeStep = runtimeJob.slice(smokeIndex, diagnosticsIndex);

    expect(smokeStep).toContain("logs --no-color ollama");
    expect(smokeStep).toContain('msg="inference compute"');
    expect(smokeStep).toContain("id=cpu");
    expect(smokeStep).toContain("library=cpu");
    expect(smokeStep).toContain("cuda|rocm|vulkan");
    expect(smokeStep).not.toContain("100% CPU");
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
      readFile(new URL(".github/workflows/ci.yml", root), "utf8"),
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
    const implementation = await readFile(new URL(".github/workflows/ci.yml", root), "utf8");
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
