import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerHardwareRoutes } from "../src/api/server-hardware-routes.js";
import type { LocalHardwareProfile } from "../src/local-ai/hardware-profile.js";

const hardware: LocalHardwareProfile = {
  cpuCores: 8,
  memoryBytes: 16 * 1024 ** 3,
  accelerators: [{ id: "injected-0", name: "NVIDIA GeForce RTX", vendor: "nvidia" }],
  gpuAvailability: { ollama: true, "faster-whisper": false },
};

describe("hardware routes", () => {
  it("returns the startup hardware with current GPU availability after authorization", async () => {
    const app = Fastify();
    const authorize = vi.fn(async () => undefined);
    const readHardware = vi.fn(async () => hardware);
    registerHardwareRoutes(app, { authorize, readHardware });
    try {
      const response = await app.inject("/api/local-ai/hardware");
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ hardware });
      expect(authorize).toHaveBeenCalledOnce();
      expect(readHardware).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("does not read hardware when authorization fails", async () => {
    const app = Fastify();
    const readHardware = vi.fn(async () => hardware);
    registerHardwareRoutes(app, {
      authorize: async () => {
        throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
      },
      readHardware,
    });
    try {
      expect((await app.inject("/api/local-ai/hardware")).statusCode).toBe(401);
      expect(readHardware).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("does not register inventory refresh, change events, or host reports", async () => {
    const app = Fastify();
    registerHardwareRoutes(app, {
      authorize: async () => undefined,
      readHardware: async () => hardware,
    });
    try {
      for (const [method, url] of [
        ["POST", "/api/local-ai/hardware/refresh"],
        ["GET", "/api/local-ai/hardware/events"],
        ["POST", "/api/internal/hardware"],
      ] as const) {
        expect(app.hasRoute({ method, url })).toBe(false);
        expect((await app.inject({ method, url })).statusCode).toBe(404);
      }
    } finally {
      await app.close();
    }
  });
});
