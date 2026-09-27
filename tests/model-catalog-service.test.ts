import { describe, expect, it, vi } from "vitest";
import { aiProfileSchema, createInitialAiProfile } from "../src/ai-profile.js";
import { LocalModelInventory } from "../src/models/local-model-inventory.js";
import { CachedModelCatalog, type CatalogSnapshot } from "../src/models/model-catalog.js";
import { ModelCatalogService } from "../src/models/model-catalog-service.js";
import { readPublicLibrary } from "../src/models/ollama-library.js";
import { OpenRouterModelPreflight } from "../src/openrouter/model-preflight.js";

const response = (value: unknown) => new Response(JSON.stringify(value));
function fixture(apiKey: string | undefined = "secret") {
  const saved = new Map<string, CatalogSnapshot>();
  const cache = new CachedModelCatalog({
    read: async (key) => saved.get(key),
    write: async (key, value) => {
      saved.set(key, value);
    },
  });
  const request = vi.fn<typeof fetch>();
  const inventory = new LocalModelInventory(request);
  const service = new ModelCatalogService(
    cache,
    inventory,
    { cpuCores: 8, memoryBytes: 16 * 1024 ** 3 },
    async () => apiKey,
    request,
  );
  return { service, request, cache, saved, inventory };
}
const textModel = {
  id: "vendor/text",
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["response_format"],
};
const audioModel = {
  id: "vendor/audio",
  architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] },
  supported_parameters: [],
};

describe("stage catalogs and cached preflight", () => {
  it("uses the selected GPU memory for advice without forbidding large models", async () => {
    const { cache, inventory, request } = fixture();
    request.mockImplementation(async (url) =>
      String(url).endsWith("/catalog")
        ? response({ items: [{ model: "small", name: "small", sizeBytes: 100 }] })
        : response({ models: [] }),
    );
    const service = new ModelCatalogService(
      cache,
      inventory,
      {
        cpuCores: 1,
        memoryBytes: 1024 ** 3,
        accelerators: [{ id: "gpu0", name: "GPU", vendor: "nvidia", memoryBytes: 8 * 1024 ** 3 }],
      },
      async () => undefined,
      request,
    );
    expect(
      (await service.list({ provider: "faster-whisper", phase: "transcription" })).items[0]
        ?.compatibility,
    ).toBe("compatible");
  });
  it("filters API choices by real stage capabilities", async () => {
    const { service, request } = fixture();
    request.mockImplementation(async () =>
      response({
        data: [textModel, audioModel, { ...textModel, id: "no-json", supported_parameters: [] }],
      }),
    );
    expect(
      (await service.list({ provider: "openrouter", phase: "summary" })).items.map(
        (item) => item.model,
      ),
    ).toEqual(["vendor/text"]);
    expect(
      (await service.list({ provider: "openrouter", phase: "transcription" })).items.map(
        (item) => item.model,
      ),
    ).toEqual(["vendor/audio"]);
    const base = createInitialAiProfile("external", "en");
    await service.validateProfile(
      aiProfileSchema.parse({
        ...base,
        transcription: { ...base.transcription, model: "vendor/audio" },
        refinement: { ...base.refinement, model: "vendor/text" },
        summary: { ...base.summary, model: "vendor/text" },
      }),
    );
    await expect(service.validateProfile(base)).rejects.toMatchObject({
      code: "profile_incomplete",
    });
    await expect(
      service.requireSelection("summary", "openrouter", "no-json"),
    ).rejects.toMatchObject({ code: "model_not_in_catalog" });
  });
  it("reads public Ollama variants and installed inventory, with hardware advice", async () => {
    const { service, request } = fixture();
    request.mockImplementation(async (url) => {
      if (String(url).endsWith("/tags") && String(url).startsWith("https"))
        return new Response('<a href="/library/qwen3:8b">qwen3:8b 5.2GB Text input</a>');
      if (String(url).endsWith("/library"))
        return new Response('<a href="/library/qwen3">qwen3</a>');
      return response({ models: [{ name: "qwen3:8b", size: 5_200_000_000 }] });
    });
    expect(
      (await service.list({ provider: "ollama", phase: "summary" })).items[0]?.variantsAvailable,
    ).toBe(true);
    const list = await service.list({ provider: "ollama", phase: "summary", family: "qwen3" });
    expect(list.items[0]).toMatchObject({
      model: "qwen3:8b",
      installed: true,
      sizeBytes: 5_200_000_000,
      compatibility: "compatible",
    });
    await service.requireSelection("summary", "ollama", "qwen3:8b");
    await expect(
      service.requireSelection("summary", "ollama", "../../other:latest"),
    ).rejects.toMatchObject({ code: "model_not_in_catalog" });
  });
  it("distinguishes failed inventory, missing models and failed catalogs", async () => {
    const { service, request } = fixture();
    request.mockImplementation(async (url) =>
      String(url).endsWith("/catalog")
        ? response({ items: [{ model: "small", name: "small", sizeBytes: 100 }] })
        : response({ models: [] }),
    );
    expect(
      (await service.list({ provider: "faster-whisper", phase: "transcription" })).items[0]
        ?.installed,
    ).toBe(false);
    request.mockRejectedValue(new Error("network secret"));
    expect(
      (await service.list({ provider: "faster-whisper", phase: "transcription" })).items[0]
        ?.installed,
    ).toBeNull();
    await expect(
      service.requireSelection("summary", "openrouter", "vendor/text"),
    ).rejects.toMatchObject({ code: "catalog_unavailable" });
    await expect(
      service.list({ provider: "ollama", phase: "transcription" }),
    ).rejects.toMatchObject({ code: "provider_not_supported_for_phase" });
    await expect(
      service.list({ provider: "faster-whisper", phase: "summary" }),
    ).rejects.toMatchObject({ code: "provider_not_supported_for_phase" });
    const noKey = fixture("");
    // The secret boundary returns undefined for an absent key.
    const missing = new ModelCatalogService(
      noKey.cache,
      noKey.inventory,
      { cpuCores: 1, memoryBytes: 1 },
      async () => undefined,
      noKey.request,
    );
    await expect(missing.list({ provider: "openrouter", phase: "summary" })).rejects.toMatchObject({
      code: "openrouter_api_key_missing",
    });
  });
  it("allows external stages of a hybrid meeting using a persisted catalog during outages", async () => {
    const { cache, request } = fixture();
    request.mockImplementation(async (url) =>
      response({ data: String(url).includes("transcription") ? [audioModel] : [textModel] }),
    );
    const preflight = new OpenRouterModelPreflight({ apiKey: "secret", fetch: request, cache });
    await preflight.validate({ generativeModels: [{ model: "vendor/text", phase: "summary" }] });
    await preflight.validate({ generativeModels: [], transcriptionModel: "vendor/audio" });
    request.mockRejectedValue(new Error("offline secret"));
    await expect(
      preflight.validate({
        generativeModels: [{ model: "vendor/text", phase: "summary" }],
        transcriptionModel: "vendor/audio",
      }),
    ).resolves.toBeUndefined();
  });
  it("bounds library responses and rejects unsuccessful HTTP responses", async () => {
    await expect(
      readPublicLibrary(
        "",
        vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>public</html>")),
      ),
    ).resolves.toContain("public");
    await expect(
      readPublicLibrary(
        "",
        vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 500 })),
      ),
    ).rejects.toMatchObject({ code: "catalog_unavailable" });
    await expect(
      readPublicLibrary(
        "",
        vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(10 * 1024 * 1024 + 1))),
      ),
    ).rejects.toMatchObject({ code: "catalog_invalid" });
  });
});
