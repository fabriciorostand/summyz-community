import { describe, expect, it, vi } from "vitest";
import { PostgresDatabase, type PostgresExecutor } from "../src/database/postgres-database.js";
import { PostgresModelCatalogStore } from "../src/database/postgres-model-catalog-store.js";
import { PostgresModelDownloadStore } from "../src/database/postgres-model-download-store.js";
import { createLogger } from "../src/logger.js";
import { LocalModelInventory } from "../src/models/local-model-inventory.js";
import { CachedModelCatalog } from "../src/models/model-catalog.js";
import { ModelCatalogService } from "../src/models/model-catalog-service.js";
import { ModelDownloadManager } from "../src/models/model-download-manager.js";
import { ModelManagement } from "../src/models/model-management.js";

function fixture() {
  const query = vi
    .fn<PostgresExecutor["query"]>()
    .mockResolvedValue({ rows: [{ in_use: false, acquired: true }], rowCount: 1 });
  const release = vi.fn();
  const database = new PostgresDatabase({
    query,
    connect: async () => ({ query, release }),
    end: async () => {},
  });
  const cache = new CachedModelCatalog({ read: async () => undefined, write: async () => {} });
  const catalog = new ModelCatalogService(
    cache,
    new LocalModelInventory(),
    { cpuCores: 1, memoryBytes: 1 },
    async () => undefined,
  );
  const store = new PostgresModelDownloadStore(database);
  const downloads = new ModelDownloadManager(
    store,
    { run: async () => {}, cleanup: async () => {} },
    createLogger("silent"),
  );
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(""));
  return {
    query,
    release,
    database,
    catalog,
    store,
    downloads,
    request,
    management: new ModelManagement(database, catalog, downloads, request),
  };
}
const row = {
  download_id: "63d3b8c0-e02a-4fdf-8179-a0feec79e7c1",
  provider: "ollama",
  model: "qwen3:8b",
  status: "queued",
  completed_bytes: "0",
  total_bytes: null,
  partial_digests: [],
  failure_code: null,
};

describe("model management persistence and removal", () => {
  it("blocks removal for active or pending meetings before contacting providers", async () => {
    const { query, management, request, release } = fixture();
    query.mockResolvedValue({ rows: [{ in_use: true, acquired: true }], rowCount: 1 });
    await expect(management.remove("ollama", "qwen3:8b")).rejects.toMatchObject({
      code: "model_in_use",
    });
    expect(request).not.toHaveBeenCalled();
    expect(query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
  it("allows removal when only profiles reference the model, but blocks active downloads", async () => {
    const { query, management, request } = fixture();
    query.mockImplementation(async (sql) => ({
      rows: sql.includes("SELECT * FROM model_downloads")
        ? []
        : [{ in_use: false, acquired: true }],
      rowCount: 1,
    }));
    await management.remove("ollama", "qwen3");
    expect(request).toHaveBeenCalledWith(
      "http://ollama:11434/api/delete",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ model: "qwen3:latest" }),
      }),
    );
    await management.remove("faster-whisper", "tiny");
    query.mockImplementation(async (sql) => ({
      rows: sql.includes("SELECT * FROM model_downloads")
        ? [row]
        : [{ in_use: false, acquired: true }],
      rowCount: 1,
    }));
    await expect(management.remove("ollama", "qwen3:8b")).rejects.toMatchObject({
      code: "model_download_active",
    });
  });
  it("reports provider deletion failures and rolls back", async () => {
    const { query, management, request } = fixture();
    query.mockImplementation(async (sql) => ({
      rows: sql.includes("SELECT * FROM model_downloads")
        ? []
        : [{ in_use: false, acquired: true }],
      rowCount: 1,
    }));
    request.mockResolvedValue(new Response("secret", { status: 500 }));
    await expect(management.remove("ollama", "qwen3:8b")).rejects.toMatchObject({
      code: "model_delete_failed",
    });
    request.mockResolvedValue(new Response("", { status: 404 }));
    await expect(management.remove("ollama", "qwen3:8b")).resolves.toBeUndefined();
  });
  it("validates selected models before creating durable download requests", async () => {
    const { query, management, catalog } = fixture();
    const validate = vi.spyOn(catalog, "requireSelection").mockResolvedValue();
    query.mockResolvedValue({ rows: [{ ...row, acquired: true }], rowCount: 1 });
    expect((await management.download("summary", "ollama", "qwen3:8b")).downloadId).toBe(
      row.download_id,
    );
    expect(validate).toHaveBeenCalledWith("summary", "ollama", "qwen3:8b");
  });
  it("persists and validates catalog snapshots and resumable download progress", async () => {
    const { query, store, database } = fixture();
    query.mockResolvedValue({ rows: [{ ...row, acquired: true }], rowCount: 1 });
    expect((await store.list())[0]?.completedBytes).toBe(0);
    expect((await store.get(row.download_id))?.totalBytes).toBeNull();
    await store.update(row.download_id, {
      completedBytes: 5,
      totalBytes: 10,
      status: "downloading",
      partialDigests: [],
    });
    await store.update(row.download_id, {});
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await store.get(row.download_id)).toBeUndefined();
    const cache = new PostgresModelCatalogStore(database);
    expect(await cache.read("key")).toBeUndefined();
    const snapshot = { fetchedAt: 1, items: [] };
    await cache.write("key", snapshot);
    query.mockResolvedValue({ rows: [{ snapshot }], rowCount: 1 });
    expect(await cache.read("key")).toEqual(snapshot);
    query.mockResolvedValue({ rows: [{ snapshot: "invalid" }], rowCount: 1 });
    await expect(cache.read("key")).rejects.toThrow();
  });
});
