import { Algorithm, hash, verify } from "@node-rs/argon2";

import type { InstallationPasswordHasher } from "./installation-password.js";

const options = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  outputLen: 32,
  parallelism: 1,
  timeCost: 2,
} as const;

export class Argon2InstallationPasswordHasher implements InstallationPasswordHasher {
  public hash(password: string): Promise<string> {
    return hash(password, options);
  }

  public verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password, options);
  }
}
