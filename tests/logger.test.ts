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
        authorization: "Bearer segredo",
        discordToken: "token-secreto",
        openRouterApiKey: "openrouter-secreto",
        transcript: "conteúdo da call",
      },
      "evento seguro",
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(output).not.toContain("Bearer segredo");
    expect(output).not.toContain("token-secreto");
    expect(output).not.toContain("openrouter-secreto");
    expect(output).not.toContain("conteúdo da call");
    expect(output).not.toContain("conteúdo do áudio");
    expect(output).toContain("[Redacted]");
  });
});
