import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createDefaultAiPrompts } from "../ai-prompts.js";
import type { ApiServerDependencies } from "./server-contracts.js";
import {
  authenticateRequest,
  clearSessionCookie,
  safeEqual,
  setSessionCookie,
} from "./server-support.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  app.get("/api/auth/discord", async (_request, reply) => {
    const settings = await dependencies.settings.getSettings();
    if (!settings.setupCompleted) {
      return reply.status(409).send({ error: "setup_required" });
    }
    return {
      authorizationUrl: await dependencies.discord.createAuthorizationUrl({ intent: "login" }),
    };
  });

  app.get("/api/setup/discord", async (request, reply) => {
    const settings = await dependencies.settings.getSettings();
    if (settings.setupCompleted) {
      return reply.status(409).send({ error: "setup_already_completed" });
    }
    const suppliedToken = z.string().parse(request.headers["x-summyz-setup-token"]);
    if (!safeEqual(suppliedToken, dependencies.setupToken)) {
      return reply.status(403).send({ error: "invalid_setup_token" });
    }
    return {
      authorizationUrl: await dependencies.discord.createAuthorizationUrl({ intent: "setup" }),
    };
  });

  app.get("/api/discord/connect", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return {
      authorizationUrl: await dependencies.discord.createAuthorizationUrl({
        initiatorDiscordUserId: user.userId,
        intent: "replace",
      }),
    };
  });

  app.get("/api/discord/callback", async (request, reply) => {
    const query = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .parse(request.query);
    const connection = await dependencies.discord.completeAuthorization(query.code, query.state);
    setSessionCookie(
      reply,
      await dependencies.auth.create(connection.discordUserId),
      dependencies.secureCookies,
    );
    return reply.redirect("/setup?discord=connected");
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionToken = request.cookies.summyz_session;
    if (sessionToken !== undefined) await dependencies.auth.logout(sessionToken);
    clearSessionCookie(reply, dependencies.secureCookies);
    return reply.status(204).send();
  });

  app.get("/api/auth/me", async (request) => authenticateRequest(request, dependencies));

  app.put("/api/account/preferences", async (request, reply) => {
    await authenticateRequest(request, dependencies);
    const preferences = z
      .object({
        dashboardLanguage: z.enum(["en", "pt-BR"]),
        dashboardTheme: z.enum(["system", "light", "dark"]),
      })
      .parse(request.body);
    await dependencies.settings.updatePreferences(preferences);
    return reply.status(204).send();
  });

  app.get("/api/ai/prompts/defaults", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    const { summaryLanguage } = z
      .object({ summaryLanguage: z.string().min(1).max(32) })
      .parse(request.query);
    return createDefaultAiPrompts(user.dashboardLanguage, summaryLanguage);
  });

  app.get("/api/discord/connection", async (request) => {
    const user = await authenticateRequest(request, dependencies);
    return dependencies.discord.getConnectionStatus(user.userId);
  });
}
