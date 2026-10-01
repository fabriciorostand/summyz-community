import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { profileLanguageSchema } from "../ai-profile.js";
import { createDefaultAiPrompts } from "../ai-prompts.js";
import { DashboardSessionError } from "../auth/dashboard-session.js";
import { InstallationLoginThrottle } from "../auth/installation-login-throttle.js";
import { installationPasswordSchema } from "../auth/installation-password.js";
import {
  createDiscordOAuthRedirectUri,
  DiscordConnectionError,
} from "../discord/installation-discord-connection.js";
import type { ApiServerDependencies } from "./server-contracts.js";
import {
  authorizeDashboard,
  clearSessionCookie,
  logApiFailure,
  parseRequestInput,
  setSessionCookie,
} from "./server-support.js";

const loginSchema = z.object({ password: z.string() });
const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: installationPasswordSchema,
});
const recoverySchema = z.object({ newPassword: installationPasswordSchema });
const discordCallbackSchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  error: z.string().min(1).max(128).optional(),
  state: z.string().min(1).max(512),
});

async function finishDiscordCallback(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: ApiServerDependencies,
  browserBinding: string,
  callback: z.infer<typeof discordCallbackSchema>,
): Promise<FastifyReply> {
  try {
    if (callback.error !== undefined) {
      await dependencies.discordConnection.cancelAuthorization(browserBinding, callback.state);
      return reply.redirect(
        callback.error === "access_denied"
          ? "/servers?discord=cancelled"
          : "/servers?discord=failed",
      );
    }
    if (callback.code === undefined) return reply.redirect("/servers?discord=failed");
    await dependencies.discordConnection.completeAuthorization(
      browserBinding,
      callback.code,
      callback.state,
    );
    if (dependencies.accessMode === "public") clearSessionCookie(reply);
    return reply.redirect("/servers?discord=connected");
  } catch (error) {
    if (error instanceof DiscordConnectionError && error.code === "invalid_oauth_state") {
      return reply.redirect("/servers?discord=invalid_state");
    }
    logApiFailure(dependencies.logger, request, error);
    return reply.redirect("/servers?discord=failed");
  }
}

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  const throttle = new InstallationLoginThrottle();

  app.get("/api/discord/connect", async (request, reply) => {
    await authorizeDashboard(request, dependencies);
    const browserBinding =
      dependencies.accessMode === "public"
        ? randomBytes(32).toString("base64url")
        : "local-installation-browser";
    const authorizationUrl =
      await dependencies.discordConnection.createAuthorizationUrl(browserBinding);
    if (dependencies.accessMode === "public") {
      reply.setCookie("summyz_oauth", browserBinding, {
        httpOnly: true,
        maxAge: 10 * 60,
        path: "/api/discord/callback",
        sameSite: "lax",
        secure: true,
      });
    }
    return {
      authorizationUrl,
    };
  });

  app.get("/api/discord/callback", async (request, reply) => {
    if (dependencies.accessMode === "local") await authorizeDashboard(request, dependencies);
    const browserBinding =
      dependencies.accessMode === "local"
        ? "local-installation-browser"
        : request.cookies.summyz_oauth;
    if (dependencies.accessMode === "public") {
      reply.clearCookie("summyz_oauth", {
        httpOnly: true,
        path: "/api/discord/callback",
        sameSite: "lax",
        secure: true,
      });
    }
    const callback = discordCallbackSchema.safeParse(request.query);
    if (browserBinding === undefined || browserBinding.length === 0 || !callback.success) {
      return reply.redirect("/servers?discord=invalid_state");
    }
    return finishDiscordCallback(request, reply, dependencies, browserBinding, callback.data);
  });

  app.get("/api/discord/connection", async (request) => {
    await authorizeDashboard(request, dependencies);
    return dependencies.discordConnection.getConnectionStatus();
  });

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
      discordRedirectUri: createDiscordOAuthRedirectUri(dependencies.publicBaseUrl),
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
