import { z } from "zod";

const blockedPasswords = new Set([
  "123456789012345",
  "1234567890123456",
  "111111111111111",
  "000000000000000",
  "administrador",
  "administrador123",
  "administrator",
  "administrator123",
  "changemechangeme",
  "letmeinletmeinletmein",
  "password123456789",
  "passwordpassword",
  "qwertyuiopasdfgh",
  "qwertyqwertyqwerty",
  "senha1234567890",
  "senhasenhasenha",
  "summyzcommunity",
  "summyz-community",
  "welcome123456789",
]);

export const installationPasswordSchema = z.string().transform((value, context) => {
  const normalized = value.normalize("NFC");
  const length = [...normalized].length;
  if (length < 15 || length > 128) {
    context.addIssue({
      code: "custom",
      message: "The installation password must contain between 15 and 128 characters",
    });
    return z.NEVER;
  }
  if (blockedPasswords.has(normalized.toLocaleLowerCase("en-US"))) {
    context.addIssue({ code: "custom", message: "The installation password is too common" });
    return z.NEVER;
  }
  return normalized;
});

export interface InstallationPasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

interface InstallationPasswordRepository {
  getPasswordHash(): Promise<string | undefined>;
  initialize(passwordHash: string): Promise<boolean>;
  replace(expectedPasswordHash: string, passwordHash: string): Promise<boolean>;
}

export class InstallationPasswordError extends Error {
  public constructor(message: "invalid_password" | "password_already_configured") {
    super(message);
    this.name = "InstallationPasswordError";
  }
}

export class InstallationPasswordService {
  readonly #hasher: InstallationPasswordHasher;
  readonly #repository: InstallationPasswordRepository;

  public constructor(options: {
    hasher: InstallationPasswordHasher;
    repository: InstallationPasswordRepository;
  }) {
    this.#hasher = options.hasher;
    this.#repository = options.repository;
  }

  public async initialize(password: string): Promise<void> {
    const hash = await this.#hasher.hash(installationPasswordSchema.parse(password));
    if (!(await this.#repository.initialize(hash))) {
      throw new InstallationPasswordError("password_already_configured");
    }
  }

  public async isConfigured(): Promise<boolean> {
    return (await this.#repository.getPasswordHash()) !== undefined;
  }

  public async authenticate(password: string): Promise<void> {
    const normalized = installationPasswordSchema.safeParse(password);
    if (!normalized.success) throw new InstallationPasswordError("invalid_password");
    const currentHash = await this.#repository.getPasswordHash();
    if (currentHash === undefined || !(await this.#hasher.verify(currentHash, normalized.data))) {
      throw new InstallationPasswordError("invalid_password");
    }
  }

  public async change(currentPassword: string, newPassword: string): Promise<void> {
    const currentHash = await this.#repository.getPasswordHash();
    const current = installationPasswordSchema.safeParse(currentPassword);
    if (
      currentHash === undefined ||
      !current.success ||
      !(await this.#hasher.verify(currentHash, current.data))
    ) {
      throw new InstallationPasswordError("invalid_password");
    }
    const nextHash = await this.#hasher.hash(installationPasswordSchema.parse(newPassword));
    if (!(await this.#repository.replace(currentHash, nextHash))) {
      throw new InstallationPasswordError("invalid_password");
    }
  }
}
