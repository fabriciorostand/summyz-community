import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const repositoryRoot = new URL("../", import.meta.url);

describe("runtime packaging", () => {
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
    const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");
    const runtimeBase = dockerfile.split(" AS runtime-base")[1]?.split(" AS bot-runtime")[0];
    const botRuntime = dockerfile.split(" AS bot-runtime")[1]?.split(" AS dashboard-runtime")[0];
    const dashboardRuntime = dockerfile.split(" AS dashboard-runtime")[1];

    expect(runtimeBase).toContain("rm -rf /usr/local/lib/node_modules/npm");
    expect(botRuntime).toContain('CMD ["node", "dist/main.js"]');
    expect(dashboardRuntime).toContain('CMD ["node", "dist/api/main.js"]');
  });

  it("usa o build FFmpeg/PyAV controlado e compatível apenas com LGPL", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");
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
    expect(dockerfile).toContain("COPY package.json package-lock.json .npmrc ./");
    expect(dockerfile).not.toContain("COPY config");
  });

  it("seleciona targets separados do bot e do dashboard no Compose", async () => {
    const compose = await readFile(new URL("docker-compose.yaml", repositoryRoot), "utf8");
    const bot = compose.split("\n  bot:")[1]?.split("\n  dashboard:")[0];
    const dashboard = compose.split("\n  dashboard:")[1]?.split("\n  smoke:")[0];

    expect(bot).toContain("target: bot-runtime");
    expect(dashboard).toContain("target: dashboard-runtime");
    expect(bot).toMatch(/postgres:\s+condition: service_healthy/u);
    expect(compose).toContain('"python3",');
    expect(compose).not.toContain('"python",');
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
      readFile(new URL("Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("services/faster-whisper/Dockerfile", repositoryRoot), "utf8"),
      readFile(new URL("docker-compose.yaml", repositoryRoot), "utf8"),
      readFile(new URL("docker-compose.amd.yaml", repositoryRoot), "utf8"),
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

  it("fixa os repositórios Debian e as versões dos pacotes Ubuntu", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");
    const fasterWhisperDockerfile = await readFile(
      new URL("services/faster-whisper/Dockerfile", repositoryRoot),
      "utf8",
    );

    for (const contents of [dockerfile, fasterWhisperDockerfile]) {
      expect(contents).toContain("DEBIAN_SNAPSHOT=20260906T000000Z");
      expect(contents).toMatch(/snapshot\.debian\.org\/archive\/debian\/\$\{DEBIAN_SNAPSHOT\}/u);
      expect(contents).toMatch(
        /snapshot\.debian\.org\/archive\/debian-security\/\$\{DEBIAN_SNAPSHOT\}/u,
      );
    }
    expect(fasterWhisperDockerfile).toContain("UBUNTU_LIBOPUS_VERSION=1.4-1build1");
    expect(fasterWhisperDockerfile).toContain("UBUNTU_PYTHON_VERSION=3.12.3-0ubuntu2.1");
    expect(fasterWhisperDockerfile).not.toContain("snapshot.ubuntu.com");
    expect(fasterWhisperDockerfile).toContain("rm -f /etc/apt/sources.list.d/cuda.list");
  });

  it("não aceita a senha PostgreSQL de exemplo como fallback", async () => {
    const compose = await readFile(new URL("docker-compose.yaml", repositoryRoot), "utf8");
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

  it("não concede a GPU NVIDIA ao processo do bot", async () => {
    const overlay = await readFile(new URL("docker-compose.nvidia.yaml", repositoryRoot), "utf8");
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
    expect(gitignore).toContain("artifacts/sbom/");
    expect(generator).toContain("docker scout sbom");
    expect(generator).toContain("cyclonedx");
    expect(generator).toContain("spdx");
    expect(generator).toContain('run("git", ["status", "--porcelain"])');
  });
});
