import { describe, expect, it, vi } from "vitest";

import {
  InstallationPasswordError,
  InstallationPasswordService,
  installationPasswordSchema,
} from "../src/auth/installation-password.js";
import { Argon2InstallationPasswordHasher } from "../src/auth/argon2-installation-password-hasher.js";

describe("installation password", () => {
  it("uses the approved Argon2id cost parameters", async () => {
    const password = "uma frase segura para o hash";
    const hasher = new Argon2InstallationPasswordHasher();
    const passwordHash = await hasher.hash(password);

    expect(passwordHash).toContain("$argon2id$v=19$m=19456,t=2,p=1$");
    expect(passwordHash).not.toContain(password);
    await expect(hasher.verify(passwordHash, password)).resolves.toBe(true);
    await expect(hasher.verify(passwordHash, "outra frase segura diferente")).resolves.toBe(false);
  });

  it("accepts long Unicode passphrases without composition rules", () => {
    expect(installationPasswordSchema.parse("uma frase segura sem símbolos")).toBe(
      "uma frase segura sem símbolos",
    );
    expect(() => installationPasswordSchema.parse("curta demais")).toThrow();
    expect(() => installationPasswordSchema.parse("summyzcommunity")).toThrow();
  });

  it("stores only a slow hash during initial setup", async () => {
    const repository = repositoryStub();
    const hasher = {
      hash: vi.fn(async () => "argon2id-hash"),
      verify: vi.fn(async () => false),
    };
    const service = new InstallationPasswordService({ hasher, repository });

    await service.initialize("uma frase segura para instalar");

    expect(repository.initialize).toHaveBeenCalledWith("argon2id-hash");
    expect(JSON.stringify(repository.initialize.mock.calls)).not.toContain(
      "uma frase segura para instalar",
    );
  });

  it("verifies the installation password without exposing its hash", async () => {
    const repository = repositoryStub({ getPasswordHash: vi.fn(async () => "stored-hash") });
    const hasher = {
      hash: vi.fn(async () => "unused"),
      verify: vi.fn(async () => true),
    };
    const service = new InstallationPasswordService({ hasher, repository });

    await expect(service.authenticate("uma frase segura para entrar")).resolves.toBeUndefined();
    expect(hasher.verify).toHaveBeenCalledWith("stored-hash", "uma frase segura para entrar");
  });

  it("requires the current password and revokes sessions after replacement", async () => {
    const repository = repositoryStub({ getPasswordHash: vi.fn(async () => "stored-hash") });
    const hasher = {
      hash: vi.fn(async () => "new-hash"),
      verify: vi.fn(async () => true),
    };
    const service = new InstallationPasswordService({ hasher, repository });

    await service.change("uma frase segura que já existe", "outra frase segura para substituir");

    expect(repository.replace).toHaveBeenCalledWith("stored-hash", "new-hash");
  });

  it("rejects invalid credentials with one public error", async () => {
    const repository = repositoryStub({ getPasswordHash: vi.fn(async () => "stored-hash") });
    const service = new InstallationPasswordService({
      hasher: { hash: vi.fn(), verify: vi.fn(async () => false) },
      repository,
    });

    await expect(service.authenticate("uma frase incorreta mas comprida")).rejects.toEqual(
      new InstallationPasswordError("invalid_password"),
    );
    await expect(service.authenticate("curta")).rejects.toEqual(
      new InstallationPasswordError("invalid_password"),
    );
  });
});

function repositoryStub(overrides: Record<string, unknown> = {}) {
  return {
    getPasswordHash: vi.fn(async () => undefined),
    initialize: vi.fn(async () => true),
    replace: vi.fn(async () => true),
    ...overrides,
  };
}
