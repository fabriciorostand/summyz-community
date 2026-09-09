import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  type AuthenticatedUser,
  dashboardLanguageSchema,
  dashboardThemeSchema,
} from "./auth-domain.js";

export const dashboardIdentitySchema = z.object({
  dashboardLanguage: dashboardLanguageSchema,
  dashboardTheme: dashboardThemeSchema,
  discordAvatar: z.string().nullable(),
  discordUserId: z.string().min(1).max(128),
  discordUsername: z.string().min(1).max(100),
});

export type DashboardIdentity = z.infer<typeof dashboardIdentitySchema>;

interface DashboardSessionRepository {
  createSession(input: {
    discordUserId: string;
    expiresAt: string;
    tokenHash: string;
  }): Promise<void>;
  findAndRefreshSession(input: {
    expiresAt: string;
    now: string;
    tokenHash: string;
  }): Promise<DashboardIdentity | undefined>;
  revokeSession(tokenHash: string): Promise<void>;
}

interface DashboardSessionServiceOptions {
  now?: () => Date;
  randomToken?: () => string;
  repository: DashboardSessionRepository;
}

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;

export class DashboardSessionError extends Error {
  public constructor() {
    super("session_expired");
    this.name = "DashboardSessionError";
  }
}

export class DashboardSessionService {
  readonly #now: () => Date;
  readonly #randomToken: () => string;
  readonly #repository: DashboardSessionRepository;

  public constructor(options: DashboardSessionServiceOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#repository = options.repository;
  }

  public async create(discordUserId: string): Promise<string> {
    const now = this.#now();
    const token = z.string().min(1).parse(this.#randomToken());
    await this.#repository.createSession({
      discordUserId: z.string().min(1).max(128).parse(discordUserId),
      expiresAt: new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
      tokenHash: hashToken(token),
    });
    return token;
  }

  public async authenticate(token: string): Promise<AuthenticatedUser> {
    const now = this.#now();
    const identity = await this.#repository.findAndRefreshSession({
      expiresAt: new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
      now: now.toISOString(),
      tokenHash: hashToken(token),
    });
    if (identity === undefined) throw new DashboardSessionError();
    const parsed = dashboardIdentitySchema.parse(identity);
    return {
      dashboardLanguage: parsed.dashboardLanguage,
      dashboardTheme: parsed.dashboardTheme,
      discordAvatar: parsed.discordAvatar,
      discordUsername: parsed.discordUsername,
      userId: parsed.discordUserId,
    };
  }

  public async logout(token: string): Promise<void> {
    await this.#repository.revokeSession(hashToken(token));
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(z.string().min(1).parse(token), "utf8").digest("base64url");
}
