import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { localAiDeviceSchema } from "../ai-profile.js";
import {
  ModelOperationError,
  modelPhaseSchema,
  modelProviderSchema,
} from "../models/model-catalog.js";
import type { ApiServerDependencies } from "./server-contracts.js";
import { authorizeDashboard, parseRequestInput } from "./server-support.js";

const localSelectionSchema = z.object({
  provider: z.enum(["ollama", "faster-whisper"]),
  model: z.string().trim().min(1).max(256),
});
export function requireModels(dependencies: ApiServerDependencies) {
  if (dependencies.models === undefined)
    throw new ModelOperationError("model_service_unavailable", 503);
  return dependencies.models;
}
export function registerModelRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  app.get("/api/models", async (request) => {
    await authorizeDashboard(request, dependencies);
    const query = parseRequestInput(
      z
        .object({
          device: localAiDeviceSchema.optional(),
          phase: modelPhaseSchema,
          provider: modelProviderSchema,
          family: z
            .string()
            .regex(/^[a-z0-9][a-z0-9._-]{0,100}$/)
            .optional(),
        })
        .refine((query) => query.provider !== "openrouter" || query.device === undefined),
      request.query,
    );
    return requireModels(dependencies).catalog.list(query);
  });
  app.get("/api/models/downloads", async (request) => {
    await authorizeDashboard(request, dependencies);
    return (await requireModels(dependencies).management.downloads.store.list()).map(
      ({ partialDigests: _, ...job }) => job,
    );
  });
  app.post("/api/models/downloads", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const body = parseRequestInput(
      localSelectionSchema.extend({ phase: modelPhaseSchema }),
      request.body,
    );
    const { partialDigests: _, ...job } = await requireModels(dependencies).management.download(
      body.phase,
      body.provider,
      body.model,
    );
    return reply.status(202).send(job);
  });
  app.post("/api/models/downloads/:downloadId/cancel", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const { downloadId } = parseRequestInput(z.object({ downloadId: z.uuid() }), request.params);
    await requireModels(dependencies).management.downloads.cancel(downloadId);
    return reply.status(202).send({ status: "cancelling" });
  });
  app.delete("/api/models", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const body = parseRequestInput(localSelectionSchema, request.body);
    await requireModels(dependencies).management.remove(body.provider, body.model);
    dependencies.logger.info({ provider: body.provider, model: body.model }, "Local model deleted");
    return reply.status(204).send();
  });
}
