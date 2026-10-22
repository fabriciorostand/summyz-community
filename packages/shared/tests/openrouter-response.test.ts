import { describe, expect, it } from "vitest";

import { readOpenRouterResponse } from "../src/cost/openrouter-response.js";

describe("OpenRouter response metadata", () => {
  it("preserva o custo lexical sem a perda de precisão do number", async () => {
    const parsed = await readOpenRouterResponse(
      new Response('{"usage":{"cost":0.123456789012345678},"content":"ok"}'),
    );

    expect(parsed).toEqual({
      body: { content: "ok", usage: { cost: 0.12345678901234568 } },
      exactCost: "0.123456789012345678",
    });
  });

  it("lê total_cost e não confunde propriedades escapadas dentro de strings", async () => {
    const parsed = await readOpenRouterResponse(
      new Response('{"data":{"message":"\\"total_cost\\":999","total_cost":4.2815e-2}}'),
      "total_cost",
    );

    expect(parsed.exactCost).toBe("4.2815e-2");
  });

  it("trata respostas vazias, inválidas e sem custo", async () => {
    await expect(readOpenRouterResponse(new Response(""))).resolves.toEqual({ body: undefined });
    await expect(readOpenRouterResponse(new Response("not-json"))).resolves.toEqual({
      body: undefined,
    });
    await expect(
      readOpenRouterResponse(Response.json({ model: "effective-model" })),
    ).resolves.toEqual({ body: { model: "effective-model" } });
  });
});
