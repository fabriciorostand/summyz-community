import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Logger } from "pino";
import type { LocalHardwareProfile } from "../local-ai/hardware-profile.js";
import { type HardwareStore, hardwareSnapshotSchema } from "../local-ai/hardware-snapshot.js";

export function deriveHardwareAgentToken(secretsKey: string): string {
  return createHash("sha256").update(`summyz-hardware/v1:${secretsKey}`).digest("hex");
}

export function registerHardwareRoutes(
  app: FastifyInstance,
  options: {
    authorize(request: FastifyRequest): Promise<void>;
    logger: Logger;
    secretsKey: string;
    store: HardwareStore;
    readHardware?: () => Promise<LocalHardwareProfile>;
  },
): void {
  const token = Buffer.from(deriveHardwareAgentToken(options.secretsKey));
  const listeners = new Set<() => void>();
  const closeStreams = new Set<() => void>();
  app.addHook("preClose", async () => {
    for (const close of closeStreams) close();
  });

  app.post("/api/internal/hardware", { bodyLimit: 65536 }, async (request, reply) => {
    const header = request.headers["x-summyz-hardware-token"];
    const supplied = Buffer.from(typeof header === "string" ? header : "");
    if (supplied.length !== token.length || !timingSafeEqual(supplied, token)) {
      return reply.status(401).send({ error: "invalid_hardware_agent" });
    }
    const parsed = hardwareSnapshotSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_hardware_snapshot" });
    if (await options.store.update(parsed.data)) {
      options.logger.info({ platform: parsed.data.platform }, "Host hardware inventory updated");
      for (const listener of listeners) listener();
    }
    return reply.status(204).send();
  });

  app.get("/api/local-ai/hardware", async (request) => {
    await options.authorize(request);
    const snapshot = await options.store.read();
    if (options.readHardware === undefined) return snapshot ?? null;
    const hardware = await options.readHardware();
    return { detectedAt: snapshot?.detectedAt ?? null, hardware };
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
