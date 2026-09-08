import { errors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const claimsSchema = z.object({
  sessionId: z.string().min(1).max(128),
  userId: z.string().min(1).max(128),
});

export interface SessionClaims {
  sessionId: string;
  userId: string;
}

interface JwtSessionSignerOptions {
  audience: string;
  issuer: string;
  secret: string;
  ttlSeconds: number;
}

export class SessionTokenError extends Error {
  public constructor() {
    super("The access token is invalid or expired");
    this.name = "SessionTokenError";
  }
}

export class JwtSessionSigner {
  readonly #audience: string;
  readonly #issuer: string;
  readonly #key: Uint8Array;
  readonly #ttlSeconds: number;

  public constructor(options: JwtSessionSignerOptions) {
    const key = Buffer.from(options.secret, "base64url");
    if (key.length < 32 || key.toString("base64url") !== options.secret) {
      throw new Error("The JWT secret must contain at least 32 bytes encoded as base64url");
    }
    this.#audience = z.string().min(1).parse(options.audience);
    this.#issuer = z.string().min(1).parse(options.issuer);
    this.#key = key;
    this.#ttlSeconds = z.number().int().min(60).max(3_600).parse(options.ttlSeconds);
  }

  public async sign(input: SessionClaims): Promise<string> {
    const claims = claimsSchema.parse(input);
    return new SignJWT({ sessionId: claims.sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setAudience(this.#audience)
      .setIssuer(this.#issuer)
      .setIssuedAt()
      .setExpirationTime(`${String(this.#ttlSeconds)}s`)
      .sign(this.#key);
  }

  public async verify(token: string): Promise<SessionClaims> {
    try {
      const verified = await jwtVerify(token, this.#key, {
        algorithms: ["HS256"],
        audience: this.#audience,
        issuer: this.#issuer,
      });
      return claimsSchema.parse({
        sessionId: verified.payload.sessionId,
        userId: verified.payload.sub,
      });
    } catch (error) {
      if (error instanceof errors.JOSEError || error instanceof z.ZodError) {
        throw new SessionTokenError();
      }
      throw error;
    }
  }
}
