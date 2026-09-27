import { describe, expect, it, vi } from "vitest";
import { createInitialAiProfile } from "../src/ai-profile.js";
import { LocalModelInventory } from "../src/models/local-model-inventory.js";

describe("local model availability", () => {
  it("reports missing stages and never downloads while checking", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).includes("tags")
                ? { models: [{ name: "qwen3:8b", size: 500 }] }
                : { models: [] },
            ),
          ),
      );
    const inventory = new LocalModelInventory(request);
    const initial = createInitialAiProfile("local", "en");
    const profile = {
      ...initial,
      transcription: { ...initial.transcription, model: "small" },
      refinement: { ...initial.refinement, model: "qwen3:8b" },
      summary: { ...initial.summary, model: "qwen3:8b" },
    };
    const result = await inventory.assess(profile);
    expect(result.status).toBe("missing_models");
    expect(result.missingModels).toEqual([
      { phase: "transcription", provider: "faster-whisper", model: "small" },
    ]);
    expect(request.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
    await expect(inventory.requireInstalled(profile)).rejects.toMatchObject({
      code: "local_models_missing",
    });
  });

  it("keeps an unavailable provider separate from missing models", async () => {
    const inventory = new LocalModelInventory(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("Authorization: secret")),
    );
    const base = createInitialAiProfile("local", "en");
    const result = await inventory.assess(base);
    expect(result.status).toBe("incomplete");
    expect(JSON.stringify(await inventory.list("ollama"))).not.toContain("secret");
    expect((await inventory.list("ollama")).status).toBe("unavailable");
  });
});
