import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createDefaultAiPrompts } from "../ai-prompts.js";
import {
  type ApiServerDependencies,
  credentialsSchema,
  registrationSchema,
} from "./server-contracts.js";
import { authenticateRequest, clearSessionCookies, setSessionCookies } from "./server-support.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const settings = await dependencies.settings.getSettings();
      if (!settings.setupCompleted || !settings.registrationEnabled) {
        return reply.status(403).send({ error: "registration_disabled" });
      }
      await dependencies.auth.register(registrationSchema.parse(request.body));
      return reply.status(202).send();
    },
  );
  app.post("/api/auth/verify", async (request, reply) => {
    const body = z.object({ token: z.string().min(1) }).parse(request.body);
    await dependencies.auth.verifyEmail(body.token);
    return reply.status(204).send();
  });
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const credentials = credentialsSchema.parse(request.body);
      const tokens = await dependencies.auth.login(credentials.email, credentials.password);
      setSessionCookies(reply, tokens, dependencies.secureCookies);
      return reply.status(204).send();
    },
  );
  app.post("/api/auth/refresh", async (request, reply) => {
    const refreshToken = request.cookies.summyz_refresh;
    if (refreshToken === undefined) return reply.status(401).send({ error: "session_expired" });
    const tokens = await dependencies.auth.refresh(refreshToken);
    setSessionCookies(reply, tokens, dependencies.secureCookies);
    return reply.status(204).send();
  });
  app.post("/api/auth/logout", async (request, reply) => {
    const accessToken = request.cookies.summyz_access;
    if (accessToken !== undefined) await dependencies.auth.logout(accessToken);
    clearSessionCookies(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });
  app.post("/api/auth/forgot-password", async (request, reply) => {
    const body = z.object({ email: z.email() }).parse(request.body);
    await dependencies.auth.requestPasswordReset(body.email);
    return reply.status(202).send();
  });
  app.post("/api/auth/reset-password", async (request, reply) => {
    const body = z
      .object({ password: z.string().min(1), token: z.string().min(1) })
      .parse(request.body);
    await dependencies.auth.resetPassword(body.token, body.password);
    return reply.status(204).send();
  });
  app.post("/api/auth/change-password", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const body = z
      .object({
        currentPassword: z.string().min(1).max(1_024),
        newPassword: z.string().min(12).max(1_024),
      })
      .parse(request.body);
    await dependencies.auth.changePassword(user.userId, body.currentPassword, body.newPassword);
    clearSessionCookies(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });
  app.get("/api/auth/me", async (request) => authenticateRequest(request, dependencies));

  app.put("/api/account/preferences", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const preferences = z
      .object({
        dashboardLanguage: z.enum(["en", "pt-BR"]),
        dashboardTheme: z.enum(["system", "light", "dark"]),
      })
      .parse(request.body);
    await dependencies.auth.updatePreferences(user.userId, preferences);
    return reply.status(204).send();
  });

  app.get("/api/ai/prompts/defaults", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    const { summaryLanguage } = z
      .object({ summaryLanguage: z.string().min(1).max(32) })
      .parse(request.query);
    return createDefaultAiPrompts(user.dashboardLanguage, summaryLanguage);
  });

  app.get("/api/discord/connect", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return { authorizationUrl: await dependencies.discord.createAuthorizationUrl(user.userId) };
  });
  app.get("/api/discord/callback", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    const query = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .parse(request.query);
    await dependencies.discord.completeAuthorization(user.userId, query.code, query.state);
    return reply.redirect("/account?discord=connected");
  });
  app.get("/api/discord/connection", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return dependencies.discord.getConnectionStatus(user.userId);
  });
  app.delete("/api/discord/connection", async (request, reply) => {
    const user = await authenticateRequest(request, dependencies);
    await dependencies.discord.disconnect(user.userId);
    return reply.status(204).send();
  });
}
