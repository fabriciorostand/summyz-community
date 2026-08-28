import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";

import { JwtSessionSigner, SessionTokenError } from "../src/auth/jwt-session.js";

describe("JWT access sessions", () => {
  const secret = Buffer.alloc(32, 11).toString("base64url");

  it("signs and validates bounded access claims", async () => {
    const signer = new JwtSessionSigner({
      audience: "summyz-dashboard",
      issuer: "summyz",
      secret,
      ttlSeconds: 900,
    });

    const token = await signer.sign({ sessionId: "session-1", userId: "user-1" });
    const claims = await signer.verify(token);

    expect(claims).toMatchObject({ sessionId: "session-1", userId: "user-1" });
  });

  it("rejects tokens from another installation", async () => {
    const first = new JwtSessionSigner({
      audience: "summyz-dashboard",
      issuer: "summyz",
      secret,
      ttlSeconds: 900,
    });
    const second = new JwtSessionSigner({
      audience: "summyz-dashboard",
      issuer: "another-installation",
      secret,
      ttlSeconds: 900,
    });

    const token = await first.sign({ sessionId: "session-1", userId: "user-1" });

    await expect(second.verify(token)).rejects.toBeInstanceOf(SessionTokenError);
  });

  it("rejects a validly signed token whose session claims are incomplete", async () => {
    const signer = new JwtSessionSigner({
      audience: "summyz-dashboard",
      issuer: "summyz",
      secret,
      ttlSeconds: 900,
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setAudience("summyz-dashboard")
      .setIssuer("summyz")
      .setExpirationTime("15m")
      .sign(Buffer.from(secret, "base64url"));

    await expect(signer.verify(token)).rejects.toBeInstanceOf(SessionTokenError);
  });

  it("rejects short, non-canonical, and invalid configuration values", () => {
    expect(
      () =>
        new JwtSessionSigner({
          audience: "summyz-dashboard",
          issuer: "summyz",
          secret: Buffer.alloc(16).toString("base64url"),
          ttlSeconds: 900,
        }),
    ).toThrow(/32 bytes/);
    expect(
      () =>
        new JwtSessionSigner({
          audience: "summyz-dashboard",
          issuer: "summyz",
          secret: `${secret}=`,
          ttlSeconds: 900,
        }),
    ).toThrow(/32 bytes/);
    expect(
      () =>
        new JwtSessionSigner({
          audience: "",
          issuer: "summyz",
          secret,
          ttlSeconds: 30,
        }),
    ).toThrow();
  });
});
