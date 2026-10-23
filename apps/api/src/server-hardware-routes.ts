import type { FastifyInstance, FastifyRequest } from "fastify";
import type { LocalHardwareProfile } from "summyz-community-shared/local-ai/hardware-profile";

export function registerHardwareRoutes(
  app: FastifyInstance,
  options: {
    authorize(request: FastifyRequest): Promise<void>;
    readHardware(): Promise<LocalHardwareProfile>;
  },
): void {
  app.get("/api/local-ai/hardware", async (request) => {
    await options.authorize(request);
    return { hardware: await options.readHardware() };
  });
}
