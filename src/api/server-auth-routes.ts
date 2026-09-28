import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { profileLanguageSchema } from "../ai-profile.js";
import { createDefaultAiPrompts } from "../ai-prompts.js";
import { DashboardSessionError } from "../auth/dashboard-session.js";
import { InstallationLoginThrottle } from "../auth/installation-login-throttle.js";
import { installationPasswordSchema } from "../auth/installation-password.js";
import type { ApiServerDependencies } from "./server-contracts.js";
import {
  authorizeDashboard,
  clearSessionCookie,
  parseRequestInput,
  setSessionCookie,
} from "./server-support.js";

const loginSchema = z.object({ password: z.string() });
const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: installationPasswordSchema,
});
const recoverySchema = z.object({ newPassword: installationPasswordSchema });

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  const throttle = new InstallationLoginThrottle();

  app.get("/api/access/status", async (request) => {
    const settings = await dependencies.settings.getSettings();
    let authenticated = dependencies.accessMode === "local";
    if (!authenticated && request.cookies.summyz_session !== undefined) {
      try {
        await authorizeDashboard(request, dependencies);
        authenticated = true;
      } catch (error) {
        if (!(error instanceof DashboardSessionError)) throw error;
      }
    }
    return {
      accessMode: dependencies.accessMode,
      authenticated,
      passwordConfigured: await dependencies.passwords.isConfigured(),
      setupCompleted: settings.setupCompleted,
    };
  });

  app.post(
    "/api/access/login",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (dependencies.accessMode !== "public") {
        return reply.status(404).send({ error: "not_found" });
      }
      throttle.check(request.ip);
      const { password } = parseRequestInput(loginSchema, request.body);
      try {
        await dependencies.passwords.authenticate(password);
      } catch (error) {
        throttle.recordFailure(request.ip);
        throw error;
      }
      throttle.recordSuccess(request.ip);
      setSessionCookie(reply, await dependencies.auth.create());
      return reply.status(204).send();
    },
  );

  app.post("/api/access/logout", async (request, reply) => {
    const sessionToken = request.cookies.summyz_session;
    if (sessionToken !== undefined && sessionToken.length > 0) {
      await dependencies.auth.logout(sessionToken);
    }
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  app.put("/api/access/password", async (request, reply) => {
    if (dependencies.accessMode !== "public") {
      return reply.status(404).send({ error: "not_found" });
    }
    await authorizeDashboard(request, dependencies);
    const body = parseRequestInput(changePasswordSchema, request.body);
    await dependencies.passwords.change(body.currentPassword, body.newPassword);
    setSessionCookie(reply, await dependencies.auth.create());
    return reply.status(204).send();
  });

  app.post(
    "/api/access/recovery",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (dependencies.accessMode !== "public") {
        return reply.status(404).send({ error: "not_found" });
      }
      const token = request.headers["x-summyz-recovery-token"];
      if (typeof token !== "string") {
        return reply.status(403).send({ error: "invalid_recovery_token" });
      }
      const { newPassword } = parseRequestInput(recoverySchema, request.body);
      await dependencies.recovery.recover(
        parseRequestInput(z.string().min(1).max(512), token),
        newPassword,
      );
      setSessionCookie(reply, await dependencies.auth.create());
      return reply.status(204).send();
    },
  );

  app.get("/api/settings", async (request) => {
    await authorizeDashboard(request, dependencies);
    const settings = await dependencies.settings.getSettings();
    return {
      accessMode: dependencies.accessMode,
      discordApplicationId: settings.discordApplicationId,
      secrets: settings.secrets,
    };
  });

  app.get("/api/ai/prompts/defaults", async (request) => {
    await authorizeDashboard(request, dependencies);
    const { summaryLanguage } = parseRequestInput(
      z.object({ summaryLanguage: profileLanguageSchema }),
      request.query,
    );
    return createDefaultAiPrompts(summaryLanguage);
  });
}
