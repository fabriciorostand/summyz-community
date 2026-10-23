import { describe, expect, it, vi } from "vitest";
import { CachedModelCatalog, type CatalogSnapshot } from "../src/models/model-catalog.js";

describe("persistent model catalog", () => {
  it("refreshes after 15 minutes and uses the persisted last success for at most 24 hours", async () => {
    let now = 0;
    let saved: CatalogSnapshot | undefined;
    const source = vi
      .fn()
      .mockResolvedValue([{ model: "vendor/model", name: "Model", sizeBytes: null }]);
    const store = {
      read: async () => saved,
      write: async (_key: string, value: CatalogSnapshot) => {
        saved = value;
      },
    };
    const catalog = new CachedModelCatalog(store, () => now);
    expect((await catalog.get("text", source)).status).toBe("fresh");
    now = 14 * 60_000;
    await catalog.get("text", source);
    expect(source).toHaveBeenCalledTimes(1);
    now = 16 * 60_000;
    source.mockRejectedValue(new Error("token=secret"));
    const restarted = new CachedModelCatalog(store, () => now);
    expect((await restarted.get("text", source)).status).toBe("stale");
    now = 25 * 60 * 60_000;
    const expired = await restarted.get("text", source);
    expect(expired.status).toBe("unavailable");
    expect(expired.items).toEqual([]);
    expect(JSON.stringify(expired)).not.toContain("secret");
  });

  it("reports an unavailable catalog without confusing it with an empty successful response", async () => {
    const catalog = new CachedModelCatalog({ read: async () => undefined, write: async () => {} });
    expect(
      (
        await catalog.get("local", async () => {
          throw new Error("offline");
        })
      ).status,
    ).toBe("unavailable");
  });
});
