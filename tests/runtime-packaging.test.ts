import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { loadWebConfig } from "../src/api/web-config.js";

const repositoryRoot = new URL("../", import.meta.url);

describe("runtime packaging", () => {
  it("keeps CPU instances while GPU overlays add independent services with shared model storage", async () => {
    const base = await readFile(new URL("compose.yaml", repositoryRoot), "utf8");
    const nvidia = await readFile(new URL("docker/compose.nvidia.yaml", repositoryRoot), "utf8");
    const amd = await readFile(new URL("docker/compose.amd.yaml", repositoryRoot), "utf8");
    expect(base).toContain("OLLAMA_LLM_LIBRARY: cpu");
    for (const overlay of [nvidia, amd]) {
      expect(overlay).toContain("  ollama-gpu:");
      expect(overlay).not.toMatch(/^ {2}ollama:/m);
      expect(overlay).toContain("ollama_models:/model-storage:ro");
    }
    expect(nvidia).toContain("  faster-whisper-gpu:");
    expect(nvidia).toContain("image: summyz-community-faster-whisper-gpu");
    expect(nvidia).not.toMatch(/^ {2}faster-whisper:/m);
    const template = await readFile(new URL(".env.example", repositoryRoot), "utf8");
    expect(template).not.toMatch(/^LOCAL_AI_(DEVICE|FALLBACK)=/m);
  });

  it("mantém FFmpeg fora das dependências Node", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", repositoryRoot), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const packageLock = await readFile(new URL("package-lock.json", repositoryRoot), "utf8");
    const audioConverter = await readFile(
      new URL("src/recording/audio-converter.ts", repositoryRoot),
      "utf8",
    );
    const speechAnalyzer = await readFile(
      new URL("src/transcription/speech-analyzer.ts", repositoryRoot),
      "utf8",
    );
    const npmConfiguration = await readFile(new URL(".npmrc", repositoryRoot), "utf8");

    expect(packageJson.dependencies).not.toHaveProperty("ffmpeg-static");
    expect(packageLock).not.toContain('"node_modules/ffmpeg-static"');
    expect(audioConverter).not.toContain('from "ffmpeg-static"');
    expect(speechAnalyzer).not.toContain('from "ffmpeg-static"');
    expect(npmConfiguration).toMatch(/^legacy-peer-deps=true$/mu);
  });

  it("mantém ferramentas de build do Tailwind fora do runtime", async () => {
    const webPackage = JSON.parse(
      await readFile(new URL("web/package.json", repositoryRoot), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(webPackage.dependencies).not.toHaveProperty("@tailwindcss/vite");
    expect(webPackage.dependencies).not.toHaveProperty("tailwindcss");
    expect(webPackage.devDependencies).toHaveProperty("@tailwindcss/vite");
    expect(webPackage.devDependencies).toHaveProperty("tailwindcss");
  });

  it("mantém o gerenciador de pacotes fora das imagens finais", async () => {
    const dockerfile = await readFile(new URL("docker/Dockerfile", repositoryRoot), "utf8");
    const runtimeBase = dockerfile.split(" AS runtime-base")[1]?.split(" AS bot-runtime")[0];
    const botRuntime = dockerfile.split(" AS bot-runtime")[1]?.split(" AS dashboard-runtime")[0];
    const dashboardRuntime = dockerfile.split(" AS dashboard-runtime")[1];

    expect(runtimeBase).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(botRuntime).toContain('CMD ["node", "dist/main.js"]');
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", repositoryRoot), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.dev).toContain("src/main.ts");
    expect(packageJson.scripts?.start).toBe("node dist/main.js");
    expect(dashboardRuntime).toContain(
      'CMD ["node", "dist/api/main.js", "--access-mode", "local"]',
    );
  });

  it("usa o build FFmpeg/PyAV controlado e compatível apenas com LGPL", async () => {
    const dockerfile = await readFile(new URL("docker/Dockerfile", repositoryRoot), "utf8");
    const ffmpegBuild = await readFile(
      new URL("docker/ffmpeg/build-lgpl.sh", repositoryRoot),
      "utf8",
    );
    const fasterWhisperDockerfile = await readFile(
      new URL("services/faster-whisper/Dockerfile", repositoryRoot),
      "utf8",
    );
    const botRuntime = dockerfile.split(" AS bot-runtime")[1]?.split(" AS dashboard-runtime")[0];
    const dashboardRuntime = dockerfile.split(" AS dashboard-runtime")[1];

    expect(ffmpegBuild).toContain("--disable-gpl");
    expect(ffmpegBuild).toContain("--disable-nonfree");
    expect(ffmpegBuild).toContain("--enable-libopus");
    expect(dockerfile).toContain("FFMPEG_SHA256=");
    expect(dockerfile).toContain(
      "COPY --chmod=0755 docker/ffmpeg/build-lgpl.sh /usr/local/bin/build-ffmpeg-lgpl",
    );
    expect(fasterWhisperDockerfile).toContain(
      "COPY --chmod=0755 docker/ffmpeg/build-lgpl.sh /usr/local/bin/build-ffmpeg-lgpl",
    );
    expect(botRuntime).toContain("COPY --from=ffmpeg-builder /opt/ffmpeg /opt/ffmpeg");
    expect(botRuntime).not.toContain("apt-get install --yes --no-install-recommends ffmpeg");
    expect(fasterWhisperDockerfile).toContain("--no-binary=av");
    expect(fasterWhisperDockerfile).toContain("requirements.lock");
    expect(dashboardRuntime).not.toContain("apt-get install");
    // Base images lag behind bookworm-security, so the scanned runtimes must apply the
    // pinned snapshot's security upgrades before they ship.
    const runtimeBase = dockerfile.split(" AS runtime-base")[1]?.split(" AS bot-runtime")[0];
    const whisperCpu = fasterWhisperDockerfile.split(" AS cpu")[1]?.split(" AS cuda")[0];
    expect(runtimeBase).toContain("apt-get upgrade --yes --no-install-recommends");
    expect(whisperCpu).toContain("apt-get upgrade --yes --no-install-recommends");
    expect(dockerfile).toContain("COPY package.json package-lock.json .npmrc ./");
    expect(dockerfile).not.toContain("COPY config");
  });

  it("seleciona targets separados do bot e do dashboard no Compose", async () => {
    const compose = await readFile(new URL("compose.yaml", repositoryRoot), "utf8");
    const bot = compose.split("\n  bot:")[1]?.split("\n  dashboard:")[0];
    const dashboard = compose.split("\n  dashboard:")[1]?.split("\n  smoke:")[0];

    expect(bot).toContain("target: bot-runtime");
    expect(bot).toContain("dockerfile: docker/Dockerfile");
    expect(dashboard).toContain("target: dashboard-runtime");
    expect(dashboard).toContain("dockerfile: docker/Dockerfile");
    expect(bot).toMatch(/postgres:\s+condition: service_healthy/u);
    expect(compose).toContain('"python3",');
    expect(compose).not.toContain('"python",');
  });

  it("publishes the dashboard on WEB_HOST while keeping its container listener reachable", async () => {
    const compose = await readFile(new URL("compose.yaml", repositoryRoot), "utf8");
    const publicCompose = await readFile(
      new URL("docker/compose.public.yaml", repositoryRoot),
      "utf8",
    );
    const dashboard = compose.split("\n  dashboard:")[1]?.split("\n  smoke:")[0];

    expect(dashboard).toMatch(/"\$\{WEB_HOST:-127\.0\.0\.1\}:\$\{WEB_PORT:-8787\}:8787"/u);
    expect(dashboard).toMatch(/WEB_HOST: 0\.0\.0\.0/u);
    expect(dashboard).toMatch(/WEB_PORT: 8787/u);
    expect(compose).toMatch(/"127\.0\.0\.1:\$\{POSTGRES_PORT:-5432\}:5432"/u);
    expect(publicCompose).toContain('"80:80"');
    expect(publicCompose).toContain('"443:443"');
    expect(publicCompose).toContain('"443:443/udp"');
    expect(publicCompose).not.toContain("WEB_HOST");
  });

  it("inclui todos os módulos locais importados pelo faster-whisper", async () => {
    const dockerfile = await readFile(
      new URL("services/faster-whisper/Dockerfile", repositoryRoot),
      "utf8",
    );
    const testStage = dockerfile.split("FROM cpu AS test")[1];

    expect(dockerfile).toContain("model_capability.py");
    expect(testStage).toMatch(/USER nobody\s*$/u);
  });

  it("usa o CTranslate2 sem a versão vulnerável do setuptools", async () => {
    const requirements = await readFile(
      new URL("services/faster-whisper/requirements.txt", repositoryRoot),
      "utf8",
    );
    const lock = await readFile(
      new URL("services/faster-whisper/requirements.lock", repositoryRoot),
      "utf8",
    );

    for (const contents of [requirements, lock]) {
      expect(contents).toContain("ctranslate2==4.8.2");
      expect(contents).toContain("setuptools==83.0.0");
      expect(contents).not.toContain("ctranslate2==4.6.0");
      expect(contents).not.toContain("setuptools==80.9.0");
    }
  });

  it("fixa imagens externas por versão e digest", async () => {
    const files = await Promise.all([
      readFile(new URL("docker/Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("services/faster-whisper/Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("compose.yaml", repositoryRoot), "utf8"),
      readFile(new URL("docker/compose.amd.yaml", repositoryRoot), "utf8"),
    ]);

    for (const contents of files) {
      for (const line of contents
        .split("\n")
        .filter((candidate) => /(?:FROM\s+\S+:\S+|image:\s+\S+\/\S+:\S+)/u.test(candidate))) {
        expect(line).toMatch(/@sha256:[a-f0-9]{64}/u);
      }
    }
    expect(files[2]).toContain("ollama/ollama:0.33.3@");
    expect(files[3]).toContain("ollama/ollama:0.33.3-rocm@");
  });

  it("fixa os repositórios Debian e protege o acesso aos repositórios Ubuntu", async () => {
    const dockerfile = await readFile(new URL("docker/Dockerfile", repositoryRoot), "utf8");
    const fasterWhisperDockerfile = await readFile(
      new URL("services/faster-whisper/Dockerfile", repositoryRoot),
      "utf8",
    );

    for (const contents of [dockerfile, fasterWhisperDockerfile]) {
      expect(contents).toContain("DEBIAN_SNAPSHOT=20260913T000000Z");
      expect(contents).not.toContain("DEBIAN_SNAPSHOT=20260906T000000Z");
      expect(contents).toMatch(/snapshot\.debian\.org\/archive\/debian\/\$\{DEBIAN_SNAPSHOT\}/u);
      expect(contents).toMatch(
        /snapshot\.debian\.org\/archive\/debian-security\/\$\{DEBIAN_SNAPSHOT\}/u,
      );
    }
    expect(fasterWhisperDockerfile).toContain("https://archive.ubuntu.com/ubuntu/");
    expect(fasterWhisperDockerfile).toContain("https://security.ubuntu.com/ubuntu/");
    expect(fasterWhisperDockerfile).toContain("Acquire::Retries=5");
    expect(fasterWhisperDockerfile).not.toContain("UBUNTU_PYTHON_VERSION");
    expect(fasterWhisperDockerfile).not.toContain("snapshot.ubuntu.com");
    expect(fasterWhisperDockerfile).toContain("rm -f /etc/apt/sources.list.d/cuda.list");
  });

  it("não aceita a senha PostgreSQL de exemplo como fallback", async () => {
    const compose = await readFile(new URL("compose.yaml", repositoryRoot), "utf8");
    const launchers = await Promise.all([
      readFile(new URL("summyz-community", repositoryRoot), "utf8"),
      readFile(new URL("summyz-community.ps1", repositoryRoot), "utf8"),
    ]);

    expect(compose).not.toContain("troque-esta-senha");
    expect(compose).toContain("${POSTGRES_PASSWORD:?");
    expect(launchers[0]).toContain("initialize_dot_env");
    expect(launchers[1]).toContain("Initialize-DotEnv");
  });

  it("não concede privilégios ou Docker Socket aos launchers", async () => {
    const launchers = await Promise.all([
      readFile(new URL("summyz-community", repositoryRoot), "utf8"),
      readFile(new URL("summyz-community.ps1", repositoryRoot), "utf8"),
    ]);

    for (const launcher of launchers) {
      expect(launcher).not.toContain("--privileged");
      expect(launcher).not.toContain("/var/run/docker.sock");
      expect(launcher).not.toMatch(/(?:^|\s)(?:source|\.)\s+\.env/mu);
    }
  });

  it("empacota o modo público com Caddy fixado e launchers dedicados", async () => {
    const [dockerfile, publicCompose, shellLauncher, powershellLauncher] = await Promise.all([
      readFile(new URL("docker/Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("docker/compose.public.yaml", repositoryRoot), "utf8"),
      readFile(new URL("summyz-community-public", repositoryRoot), "utf8"),
      readFile(new URL("summyz-community-public.ps1", repositoryRoot), "utf8"),
    ]);

    expect(dockerfile).toContain("COPY docker ./docker");
    expect(dockerfile).toContain("summyz-community-public");
    expect(publicCompose).toContain(
      "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648",
    );
    expect(publicCompose).not.toContain("/var/run/docker.sock");
    expect(publicCompose).toContain(
      'command: ["node", "dist/api/main.js", "--access-mode", "public"]',
    );
    expect(publicCompose).not.toContain("DASHBOARD_ACCESS_MODE");
    expect(shellLauncher).toContain("SUMMYZ_PUBLIC_MODE=true");
    expect(powershellLauncher).toContain("SUMMYZ_PUBLIC_MODE");
  });

  it("selects the API mode through portable npm scripts instead of environment variables", async () => {
    const metadata: unknown = JSON.parse(
      await readFile(new URL("package.json", repositoryRoot), "utf8"),
    );
    const { scripts } = z.object({ scripts: z.record(z.string(), z.string()) }).parse(metadata);
    const template = await readFile(new URL(".env.example", repositoryRoot), "utf8");

    expect(template).not.toMatch(/^DASHBOARD_ACCESS_MODE=/m);
    expect(scripts).not.toHaveProperty("dev:api");
    expect(scripts).not.toHaveProperty("start:api");
    for (const mode of ["local", "public"] as const) {
      for (const name of [`dev:api:${mode}`, `api:${mode}`]) {
        const script = scripts[name];
        if (script === undefined) throw new Error(`Missing npm script: ${name}`);
        expect(script).not.toContain("DASHBOARD_ACCESS_MODE");
        const entryPoint = name.startsWith("dev:") ? "src/api/main.ts" : "dist/api/main.js";
        expect(script).toContain(entryPoint);
        const arguments_ = script
          .slice(script.indexOf(entryPoint) + entryPoint.length)
          .trim()
          .split(" ");

        expect(
          loadWebConfig(
            {
              DATABASE_URL: "postgresql://test:test@localhost:5432/test",
              SUMMYZ_SECRETS_KEY: Buffer.alloc(32, 8).toString("base64url"),
              SUMMYZ_SETUP_TOKEN: "s".repeat(43),
              DASHBOARD_ACCESS_MODE: mode === "local" ? "public" : "local",
              PUBLIC_BASE_URL: "https://example.com",
              WEB_HOST: mode === "local" ? "127.0.0.1" : "0.0.0.0",
            },
            arguments_,
          ),
        ).toMatchObject({ accessMode: mode });
      }
    }
  });

  it("não concede a GPU NVIDIA ao processo do bot", async () => {
    const overlay = await readFile(new URL("docker/compose.nvidia.yaml", repositoryRoot), "utf8");
    const bot = overlay.split("\n  bot:")[1]?.split("\n  smoke:")[0];

    expect(bot).not.toContain("gpus:");
  });
});

describe("release evidence", () => {
  it("prepares reproducible SBOM generation without versioning generated artifacts", async () => {
    const packageJson = await readFile(new URL("package.json", repositoryRoot), "utf8");
    const gitignore = await readFile(new URL(".gitignore", repositoryRoot), "utf8");
    const generator = await readFile(
      new URL("scripts/release/generate-sbom.mjs", repositoryRoot),
      "utf8",
    );

    expect(packageJson).toContain('"release:sbom"');
    expect(gitignore).toContain("artifacts/");
    expect(generator).toContain("docker scout sbom");
    expect(generator).toContain("cyclonedx");
    expect(generator).toContain("spdx");
    expect(generator).toContain('run("git", ["status", "--porcelain"])');
  });
});
