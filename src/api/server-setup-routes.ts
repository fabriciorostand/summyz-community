import type { FastifyInstance } from "fastify";

import { createEmptyInitialAiProfile } from "../ai-profile.js";
import { InstallationPasswordError } from "../auth/installation-password.js";
import { createDiscordOAuthRedirectUri } from "../discord/installation-discord-connection.js";
import type { ApiServerDependencies } from "./server-contracts.js";
import { setupSchema } from "./server-contracts.js";
import { parseRequestInput, safeEqual, setSessionCookie } from "./server-support.js";

export function registerSetupRoutes(
  app: FastifyInstance,
  dependencies: ApiServerDependencies,
): void {
  app.get("/api/setup/status", async () => {
    const settings = await dependencies.settings.getSettings();
    return {
      accessMode: dependencies.accessMode,
      discordRedirectUri: createDiscordOAuthRedirectUri(dependencies.publicBaseUrl),
      passwordConfigured: await dependencies.passwords.isConfigured(),
      setupCompleted: settings.setupCompleted,
      technicalSetupCompleted:
        settings.discordApplicationId !== null && settings.secrets.discordBotToken,
    };
  });

  app.post(
    "/api/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const current = await dependencies.settings.getSettings();
      if (current.setupCompleted) {
        return reply.status(409).send({ error: "setup_already_completed" });
      }
      if (!hasValidSetupClaim(request.headers["x-summyz-setup-token"], dependencies)) {
        return reply.status(403).send({ error: "invalid_setup_token" });
      }
      const setup = parseRequestInput(setupSchema, request.body);
      if (dependencies.accessMode === "public" && setup.installationPassword === undefined) {
        return reply.status(400).send({ error: "installation_password_required" });
      }
      const application = await dependencies.guildDirectory.inspectBotToken(setup.discordBotToken);
      await dependencies.settings.configureDiscordBot(application.id, setup.discordBotToken);
      if (setup.discordClientSecret !== undefined) {
        await dependencies.settings.setSecret("discord_client_secret", setup.discordClientSecret);
      }
      if (dependencies.accessMode === "public") {
        await initializePublicPassword(dependencies, setup.installationPassword ?? "");
      }
      await createMissingInitialProfiles(dependencies, setup.setupLanguage);
      await dependencies.settings.completeSetup();
      if (dependencies.accessMode === "public") {
        setSessionCookie(reply, await dependencies.auth.create());
      }
      return reply.status(204).send();
    },
  );
}

function hasValidSetupClaim(
  suppliedToken: string | string[] | undefined,
  dependencies: ApiServerDependencies,
): boolean {
  return (
    dependencies.accessMode === "local" ||
    (typeof suppliedToken === "string" && safeEqual(suppliedToken, dependencies.setupToken))
  );
}

async function initializePublicPassword(
  dependencies: ApiServerDependencies,
  password: string,
): Promise<void> {
  try {
    await dependencies.passwords.initialize(password);
  } catch (error) {
    if (
      !(error instanceof InstallationPasswordError) ||
      error.message !== "password_already_configured"
    ) {
      throw error;
    }
    await dependencies.passwords.authenticate(password);
  }
}

async function createMissingInitialProfiles(
  dependencies: ApiServerDependencies,
  setupLanguage: "en" | "pt-BR",
): Promise<void> {
  const existingProfiles = await dependencies.aiProfiles.listProfiles();
  if (existingProfiles.length === 0) {
    await dependencies.aiProfiles.createProfile(createEmptyInitialAiProfile(setupLanguage));
  }
}
