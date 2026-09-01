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

  it("instala FFmpeg no bot e nos testes, mas não no dashboard", async () => {
    const dockerfile = await readFile(new URL("Dockerfile", repositoryRoot), "utf8");
    const testRuntime = dockerfile.split(" AS test")[1]?.split("FROM node:22-bookworm-slim")[0];
    const botRuntime = dockerfile.split(" AS bot-runtime")[1]?.split(" AS dashboard-runtime")[0];
    const dashboardRuntime = dockerfile.split(" AS dashboard-runtime")[1];

    expect(botRuntime).toContain("apt-get install --yes --no-install-recommends ffmpeg");
    expect(testRuntime).toContain("apt-get install --yes --no-install-recommends ffmpeg");
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

    expect(dockerfile).toContain("model_capability.py");
  });

  it("não concede privilégios ou Docker Socket aos launchers", async () => {
    const launchers = await Promise.all([
      readFile(new URL("summyz", repositoryRoot), "utf8"),
      readFile(new URL("summyz.ps1", repositoryRoot), "utf8"),
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
