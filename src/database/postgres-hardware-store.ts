import { z } from "zod";
import {
  type HardwareSnapshot,
  type HardwareStore,
  hardwareSnapshotSchema,
} from "../local-ai/hardware-snapshot.js";
import type { PostgresExecutor } from "./postgres-database.js";

export class PostgresHardwareStore implements HardwareStore {
  public constructor(private readonly database: PostgresExecutor) {}

  public async read(): Promise<HardwareSnapshot | undefined> {
    const result = await this.database.query(
      "SELECT snapshot FROM local_hardware_snapshot WHERE snapshot_id = 'host'",
    );
    const row = result.rows[0];
    return row === undefined
      ? undefined
      : z.object({ snapshot: hardwareSnapshotSchema }).parse(row).snapshot;
  }

  public async update(input: HardwareSnapshot): Promise<boolean> {
    const snapshot = hardwareSnapshotSchema.parse(input);
    const result = await this.database.query(
      `
INSERT INTO local_hardware_snapshot (snapshot_id, snapshot, detected_at)
VALUES ('host', $1::jsonb, $2)
ON CONFLICT (snapshot_id) DO UPDATE SET
  snapshot = EXCLUDED.snapshot,
  detected_at = EXCLUDED.detected_at,
  received_at = now()
WHERE local_hardware_snapshot.detected_at < EXCLUDED.detected_at
RETURNING snapshot_id`,
      [JSON.stringify(snapshot), snapshot.detectedAt],
    );
    return result.rowCount === 1;
  }
}
