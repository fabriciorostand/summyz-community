import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/logger.js";

describe("logger", () => {
  it("redige credenciais e conteúdo sensível", async () => {
    const destination = new PassThrough();
    let output = "";
    destination.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const logger = createLogger("info", destination);

    logger.info(
      {
        audio: "conteúdo do áudio",
        clientSecret: "client-secret-sensitive",
        authorization: "Bearer segredo",
        discordToken: "token-secreto",
        entries: [{ text: "conteúdo em blocos" }],
        openRouterApiKey: "openrouter-secreto",
        password: "installation-password-sensitive",
        currentPassword: "current-password-sensitive",
        newPassword: "new-password-sensitive",
        installationPassword: "setup-password-sensitive",
        refreshToken: "refresh-token-sensitive",
        secretsKey: "master-key-sensitive",
        SUMMYZ_SECRETS_KEY: "summyz-master-key-sensitive",
        SUMMYZ_SETUP_TOKEN: "summyz-setup-token-sensitive",
        headers: {
          "x-summyz-recovery-token": "recovery-header-sensitive",
          "x-summyz-setup-token": "summyz-header-sensitive",
        },
        summary: "resumo sensível da reunião",
        transcript: "conteúdo da call",
      },
      "evento seguro",
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).not.toContain("Bearer segredo");
    expect(output).not.toContain("token-secreto");
    expect(output).not.toContain("openrouter-secreto");
    expect(output).not.toContain("client-secret-sensitive");
    expect(output).not.toContain("refresh-token-sensitive");
    expect(output).not.toContain("master-key-sensitive");
    expect(output).not.toContain("summyz-master-key-sensitive");
    expect(output).not.toContain("summyz-setup-token-sensitive");
    expect(output).not.toContain("summyz-header-sensitive");
    expect(output).not.toContain("recovery-header-sensitive");
    expect(output).not.toContain("installation-password-sensitive");
    expect(output).not.toContain("current-password-sensitive");
    expect(output).not.toContain("new-password-sensitive");
    expect(output).not.toContain("setup-password-sensitive");
    expect(output).not.toContain("conteúdo da call");
    expect(output).not.toContain("conteúdo do áudio");
    expect(output).not.toContain("conteúdo em blocos");
    expect(output).not.toContain("resumo sensível da reunião");
    expect(output).toContain("[Redacted]");
  });
});
