import { describe, expect, it } from "vitest";

import { Argon2PasswordHasher } from "../src/auth/password-hasher.js";

describe("Argon2PasswordHasher", () => {
  it("hashes with Argon2id and verifies without retaining the password", async () => {
    const hasher = new Argon2PasswordHasher();

    const hash = await hasher.hash("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse battery staple");
    await expect(hasher.verify(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(hasher.verify(hash, "incorrect password")).resolves.toBe(false);
  });
});
