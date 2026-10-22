import {
  type CatalogCacheStore,
  type CatalogSnapshot,
  catalogSnapshotSchema,
} from "../models/model-catalog.js";
import type { PostgresExecutor } from "./postgres-database.js";

export class PostgresModelCatalogStore implements CatalogCacheStore {
  public constructor(private readonly database: PostgresExecutor) {}
  public async read(key: string): Promise<CatalogSnapshot | undefined> {
    const result = await this.database.query(
      "SELECT snapshot FROM model_catalog_cache WHERE cache_key = $1",
      [key],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return catalogSnapshotSchema.parse(row.snapshot);
  }
  public async write(key: string, snapshot: CatalogSnapshot): Promise<void> {
    await this.database.query(
      `INSERT INTO model_catalog_cache (cache_key, snapshot)
      VALUES ($1, $2::jsonb) ON CONFLICT (cache_key) DO UPDATE SET snapshot = EXCLUDED.snapshot`,
      [key, JSON.stringify(catalogSnapshotSchema.parse(snapshot))],
    );
  }
}
