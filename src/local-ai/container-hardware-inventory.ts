import type { Logger } from "pino";
import {
  type HardwareSnapshot,
  type HardwareStore,
  hardwareProfileSchema,
  InvalidHardwareSnapshotError,
} from "./hardware-snapshot.js";

export interface ContainerHardwareReport {
  source: "container";
  status: "current" | "stale";
  detectedAt: string;
  hardware: HardwareSnapshot["hardware"];
}

export class ContainerHardwareInventory {
  private refreshing = false;
  private stale = false;
  private lastValid: HardwareSnapshot | undefined;

  constructor(
    private readonly options: {
      store: HardwareStore;
      logger: Logger;
      detect(): Promise<unknown>;
    },
  ) {}

  async initialize(): Promise<ContainerHardwareReport> {
    return this.refresh();
  }

  async read(): Promise<ContainerHardwareReport> {
    const snapshot = await this.options.store.read().catch(() => {
      this.stale = true;
      this.options.logger.error(
        { code: "hardware_inventory_unavailable" },
        "Unable to read stored hardware inventory",
      );
      return this.lastValid;
    });
    if (snapshot === undefined) throw new Error("hardware_inventory_unavailable");
    this.lastValid = snapshot;
    return this.report(snapshot);
  }

  private report(snapshot: HardwareSnapshot): ContainerHardwareReport {
    return {
      source: "container",
      status: this.stale ? "stale" : "current",
      detectedAt: snapshot.detectedAt,
      hardware: snapshot.hardware,
    };
  }

  async refresh(): Promise<ContainerHardwareReport> {
    if (this.refreshing) throw new Error("hardware_refresh_in_progress");
    this.refreshing = true;
    try {
      const hardware = hardwareProfileSchema.parse(await this.options.detect());
      const previousDetectionTime = await this.readPreviousDetectionTime();
      const detectedAt = new Date(Math.max(Date.now(), previousDetectionTime + 1)).toISOString();
      const snapshot: HardwareSnapshot = { detectedAt, platform: "linux", hardware };
      const accepted = await this.options.store.update(snapshot);
      this.lastValid = accepted ? snapshot : await this.options.store.read();
      if (this.lastValid === undefined) throw new Error("hardware_inventory_unavailable");
      this.stale = false;
      const report = this.report(this.lastValid);
      this.options.logger.info("Container hardware inventory updated");
      return report;
    } catch {
      this.stale = true;
      this.options.logger.error(
        { code: "hardware_detection_failed" },
        "Container hardware inventory update failed",
      );
      throw new Error("hardware_detection_failed");
    } finally {
      this.refreshing = false;
    }
  }

  private async readPreviousDetectionTime(): Promise<number> {
    try {
      const previous = await this.options.store.read();
      return previous === undefined ? 0 : Date.parse(previous.detectedAt);
    } catch (error: unknown) {
      if (!(error instanceof InvalidHardwareSnapshotError)) throw error;
      this.options.logger.warn(
        { code: "invalid_hardware_snapshot" },
        "Replacing invalid stored hardware inventory with a valid detection",
      );
      return Date.parse(error.detectedAt);
    }
  }
}
