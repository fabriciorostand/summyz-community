import { Algorithm, hash, verify } from "@node-rs/argon2";

import { passwordSchema } from "./auth-domain.js";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export class Argon2PasswordHasher implements PasswordHasher {
  public async hash(password: string): Promise<string> {
    return hash(passwordSchema.parse(password), {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      parallelism: 1,
      timeCost: 2,
    });
  }

  public async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }
}
