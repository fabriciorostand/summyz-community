import type { PostgresExecutor } from "../database/postgres-database.js";
import { ModelOperationError } from "./model-catalog.js";

export async function lockModelLifecycle(database: PostgresExecutor): Promise<void> {
  const result = await database.query(
    "SELECT pg_try_advisory_xact_lock(hashtext('summyz_model_lifecycle')) AS acquired",
  );
  if (result.rows[0]?.acquired !== true) throw new ModelOperationError("model_lifecycle_busy");
}
