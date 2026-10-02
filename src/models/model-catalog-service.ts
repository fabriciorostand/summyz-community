import { z } from "zod";
import { type AiProfile, assessModelCompatibility } from "../ai-profile.js";
import type { LocalHardwareProfile } from "../local-ai/hardware-profile.js";
import {
  type LocalAiDevice,
  resolveLocalExecutionPlan,
} from "../local-ai/local-execution-policy.js";
import { OpenRouterModelPreflight } from "../openrouter/model-preflight.js";
import { type LocalModelInventory, normalizeModel } from "./local-model-inventory.js";
import {
  type CachedModelCatalog,
  type CatalogResult,
  catalogItemSchema,
  ModelOperationError,
  type ModelPhase,
  type ModelProvider,
} from "./model-catalog.js";
import { parseOllamaFamilies, parseOllamaVariants, readPublicLibrary } from "./ollama-library.js";

export interface CatalogQuery {
  phase: ModelPhase;
  provider: ModelProvider;
  family?: string | undefined;
  device?: LocalAiDevice | undefined;
}
export class ModelCatalogService {
  public constructor(
    private readonly cache: CachedModelCatalog,
    private readonly inventory: LocalModelInventory,
    private readonly hardware: LocalHardwareProfile | (() => Promise<LocalHardwareProfile>),
    private readonly getApiKey: () => Promise<string | undefined>,
    private readonly request: typeof fetch = fetch,
  ) {}

  public async list(query: CatalogQuery) {
    const hardware = typeof this.hardware === "function" ? await this.hardware() : this.hardware;
    const catalog = await this.#catalog(query);
    const installed =
      query.provider === "openrouter" ? undefined : await this.inventory.list(query.provider);
    return {
      ...catalog,
      phase: query.phase,
      provider: query.provider,
      inventoryStatus: installed?.status ?? "not_applicable",
      installedModels: installed?.models ?? [],
      items: catalog.items.map((item) => ({
        ...item,
        installed:
          query.provider === "openrouter"
            ? null
            : installed?.status === "unavailable"
              ? null
              : (installed?.models.some(
                  (entry) =>
                    normalizeModel(
                      query.provider === "ollama" ? "ollama" : "faster-whisper",
                      entry.model,
                    ) === item.model,
                ) ?? false),
        compatibility: this.#compatibility(query, item.model, hardware, item.sizeBytes),
      })),
    };
  }

  #compatibility(
    query: CatalogQuery,
    model: string,
    hardware: LocalHardwareProfile,
    modelSizeBytes: number | null,
  ) {
    if (query.provider === "openrouter") return "unknown" as const;
    try {
      const plan = resolveLocalExecutionPlan({
        device: query.device ?? "auto",
        fallback: "none",
        enabledPhases: [query.phase],
        hardware,
      });
      const phase = plan[query.phase];
      if (phase.device === "gpu" && phase.gpuMemoryBytes === undefined) return "unknown" as const;
      return assessModelCompatibility({
        device: phase.device,
        hardware: {
          ...hardware,
          ...(phase.gpuMemoryBytes === undefined ? {} : { gpuMemoryBytes: phase.gpuMemoryBytes }),
        },
        model,
        modelSizeBytes,
        provider: query.provider,
        phase: query.phase,
      });
    } catch {
      return "incompatible" as const;
    }
  }

  public async validateProfile(profile: AiProfile): Promise<void> {
    for (const phase of ["transcription", "refinement", "summary"] as const) {
      const selection = profile[phase];
      if (selection.model === null || selection.provider === null)
        throw new ModelOperationError("profile_incomplete", 400);
      if (selection.provider !== "openrouter") {
        const hardware =
          typeof this.hardware === "function" ? await this.hardware() : this.hardware;
        try {
          resolveLocalExecutionPlan({
            device: selection.device,
            enabledPhases: [phase],
            fallback: "none",
            hardware,
          });
        } catch {
          throw new ModelOperationError("local_gpu_unavailable", 409);
        }
      }
      await this.requireSelection(phase, selection.provider, selection.model);
    }
  }

  public async requireSelection(
    phase: ModelPhase,
    provider: ModelProvider,
    model: string,
  ): Promise<void> {
    const family = provider === "ollama" ? model.split(":")[0] : undefined;
    const catalog = await this.#catalog({
      phase,
      provider,
      ...(family === undefined ? {} : { family }),
    });
    if (catalog.status === "unavailable") throw new ModelOperationError("catalog_unavailable", 503);
    const identifier = provider === "ollama" ? normalizeModel(provider, model) : model;
    if (!catalog.items.some((entry) => entry.model === identifier))
      throw new ModelOperationError("model_not_in_catalog", 400);
  }

  async #catalog(query: CatalogQuery): Promise<CatalogResult> {
    if (
      (query.provider === "faster-whisper" && query.phase !== "transcription") ||
      (query.provider === "ollama" && query.phase === "transcription")
    )
      throw new ModelOperationError("provider_not_supported_for_phase", 400);
    if (query.provider === "openrouter") {
      const apiKey = await this.getApiKey();
      if (apiKey === undefined) throw new ModelOperationError("openrouter_api_key_missing", 409);
      const result = await new OpenRouterModelPreflight({
        apiKey,
        cache: this.cache,
        fetch: this.request,
      }).list(query.phase === "transcription");
      return {
        ...result,
        items: result.items.filter((item) =>
          query.phase === "transcription"
            ? item.inputModalities?.includes("audio") &&
              item.outputModalities?.includes("transcription")
            : item.inputModalities?.includes("text") &&
              item.outputModalities?.includes("text") &&
              item.supportedParameters?.includes("response_format"),
        ),
      };
    }
    if (query.provider === "faster-whisper") {
      return this.cache.get("faster-whisper:catalog", async () => {
        const response = await this.request("http://faster-whisper:8000/models/catalog", {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new ModelOperationError("catalog_unavailable", 503);
        return z.object({ items: z.array(catalogItemSchema) }).parse(await response.json()).items;
      });
    }
    const families = await this.cache.get("ollama:library", async () =>
      parseOllamaFamilies(await readPublicLibrary("", this.request)),
    );
    if (query.family === undefined || families.status === "unavailable") return families;
    if (!families.items.some((entry) => entry.family === query.family))
      throw new ModelOperationError("model_not_in_catalog", 400);
    return this.cache.get(`ollama:${query.family}`, async () =>
      parseOllamaVariants(
        await readPublicLibrary(`/${encodeURIComponent(query.family ?? "")}/tags`, this.request),
        query.family ?? "",
      ),
    );
  }
}
