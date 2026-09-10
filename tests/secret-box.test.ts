import { describe, expect, it } from "vitest";

import { SecretBox, SecretDecryptionError } from "../src/security/secret-box.js";

describe("SecretBox", () => {
  const key = Buffer.alloc(32, 7).toString("base64url");

  it("encrypts without exposing plaintext and decrypts it", () => {
    const box = new SecretBox(key);

    const encrypted = box.encrypt("discord-token-value");

    expect(encrypted).not.toContain("discord-token-value");
    expect(box.decrypt(encrypted)).toBe("discord-token-value");
  });

  it("rejects tampered ciphertext", () => {
    const box = new SecretBox(key);
    const encrypted = box.encrypt("installation-secret-value");
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => box.decrypt(tampered)).toThrow(SecretDecryptionError);
  });

  it("requires exactly 32 bytes encoded as base64url", () => {
    expect(() => new SecretBox("short-key")).toThrow(/32 bytes/i);
  });

  it("rejects malformed envelopes and ciphertext encrypted with another key", () => {
    const box = new SecretBox(key);
    const otherBox = new SecretBox(Buffer.alloc(32, 9).toString("base64url"));

    expect(() => box.decrypt("v2.invalid.envelope")).toThrow(SecretDecryptionError);
    expect(() => box.decrypt(otherBox.encrypt("discord-token"))).toThrow(SecretDecryptionError);
  });
});
