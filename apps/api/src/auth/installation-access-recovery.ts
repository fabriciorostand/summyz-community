import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  type InstallationPasswordHasher,
  installationPasswordSchema,
} from "./installation-password.js";

interface InstallationAccessRecoveryRepository {
  consumeRecoveryToken(input: {
    now: string;
    passwordHash: string;
    tokenHash: string;
  }): Promise<boolean>;
  createRecoveryToken(input: { expiresAt: string; tokenHash: string }): Promise<void>;
}

interface RecoveryServiceOptions {
  hasher: InstallationPasswordHasher;
  now?: () => Date;
  randomToken?: () => string;
  repository: InstallationAccessRecoveryRepository;
}

const RECOVERY_DURATION_MS = 10 * 60 * 1_000;

export class InstallationAccessRecoveryError extends Error {
  public constructor() {
    super("invalid_recovery_token");
    this.name = "InstallationAccessRecoveryError";
  }
}

export class InstallationAccessRecoveryService {
  readonly #hasher: InstallationPasswordHasher;
  readonly #now: () => Date;
  readonly #randomToken: () => string;
  readonly #repository: InstallationAccessRecoveryRepository;

  public constructor(options: RecoveryServiceOptions) {
    this.#hasher = options.hasher;
    this.#now = options.now ?? (() => new Date());
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#repository = options.repository;
  }

  public async create(): Promise<string> {
    const token = z.string().min(32).parse(this.#randomToken());
    const now = this.#now();
    await this.#repository.createRecoveryToken({
      expiresAt: new Date(now.getTime() + RECOVERY_DURATION_MS).toISOString(),
      tokenHash: hashToken(token),
    });
    return token;
  }

  public async recover(token: string, password: string): Promise<void> {
    const passwordHash = await this.#hasher.hash(installationPasswordSchema.parse(password));
    const recovered = await this.#repository.consumeRecoveryToken({
      now: this.#now().toISOString(),
      passwordHash,
      tokenHash: hashToken(token),
    });
    if (!recovered) throw new InstallationAccessRecoveryError();
  }
}

function hashToken(token: string): string {
  return createHash("sha256")
    .update(z.string().min(1).max(512).parse(token), "utf8")
    .digest("base64url");
}
