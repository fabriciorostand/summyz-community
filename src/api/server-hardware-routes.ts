import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { ContainerHardwareInventory } from "../local-ai/container-hardware-inventory.js";
import type { LocalHardwareProfile } from "../local-ai/hardware-profile.js";
import type { HardwareStore } from "../local-ai/hardware-snapshot.js";

export function registerHardwareRoutes(
  app: FastifyInstance,
  options: {
    authorize(request: FastifyRequest): Promise<void>;
    logger: Logger;
    store: HardwareStore;
    readHardware?: () => Promise<LocalHardwareProfile>;
    containerInventory?: Pick<ContainerHardwareInventory, "read" | "refresh">;
  },
): void {
  const listeners = new Set<() => void>();
  const closeStreams = new Set<() => void>();
  app.addHook("preClose", async () => {
    for (const close of closeStreams) close();
  });

  app.get("/api/local-ai/hardware", async (request) => {
    await options.authorize(request);
    if (options.containerInventory !== undefined) {
      const report = await options.containerInventory.read();
      if (options.readHardware === undefined) return report;
      try {
        return { ...report, hardware: await options.readHardware() };
      } catch {
        options.logger.warn(
          { code: "hardware_availability_unavailable" },
          "Unable to check current hardware availability; returning last valid inventory",
        );
        return report;
      }
    }
    const snapshot = await options.store.read();
    if (options.readHardware === undefined) return snapshot ?? null;
    const hardware = await options.readHardware();
    return { detectedAt: snapshot?.detectedAt ?? null, hardware };
  });
  app.post("/api/local-ai/hardware/refresh", { bodyLimit: 1024 }, async (request, reply) => {
    await options.authorize(request);
    if (options.containerInventory === undefined) {
      return reply.status(404).send({ error: "manual_hardware_refresh_unavailable" });
    }
    if (!z.object({}).strict().optional().safeParse(request.body).success) {
      return reply.status(400).send({ error: "invalid_hardware_refresh" });
    }
    try {
      const report = await options.containerInventory.refresh();
      for (const listener of listeners) listener();
      return report;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "hardware_refresh_in_progress") {
        return reply.status(409).send({ error: "hardware_refresh_in_progress" });
      }
      for (const listener of listeners) listener();
      return reply.status(503).send({
        error: "hardware_detection_failed",
        inventory: await options.containerInventory.read(),
      });
    }
  });
  app.get("/api/local-ai/hardware/events", async (request, reply) => {
    await options.authorize(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    });
    const notify = () => {
      if (!reply.raw.destroyed) reply.raw.write("event: hardware-changed\ndata: {}\n\n");
    };
    const close = () => {
      listeners.delete(notify);
      closeStreams.delete(close);
      reply.raw.end();
    };
    listeners.add(notify);
    closeStreams.add(close);
    reply.raw.once("close", close);
    notify();
  });
}
