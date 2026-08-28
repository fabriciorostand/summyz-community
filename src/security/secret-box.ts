import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function decodeCanonicalBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new SecretDecryptionError();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new SecretDecryptionError();
  return decoded;
}

export class SecretDecryptionError extends Error {
  public constructor() {
    super("The encrypted secret could not be decrypted");
    this.name = "SecretDecryptionError";
  }
}

export class SecretBox {
  readonly #key: Buffer;

  public constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, "base64url");
    if (key.length !== 32 || key.toString("base64url") !== encodedKey) {
      throw new Error("SUMMYZ_SECRETS_KEY must contain exactly 32 bytes encoded as base64url");
    }
    this.#key = key;
  }

  public encrypt(plaintext: string): string {
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.#key, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    return [VERSION, initializationVector, authenticationTag, ciphertext]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  public decrypt(serialized: string): string {
    try {
      const [version, encodedIv, encodedTag, encodedCiphertext, extra] = serialized.split(".");
      if (
        version !== VERSION ||
        encodedIv === undefined ||
        encodedTag === undefined ||
        encodedCiphertext === undefined ||
        extra !== undefined
      ) {
        throw new SecretDecryptionError();
      }
      const initializationVector = decodeCanonicalBase64Url(encodedIv);
      const authenticationTag = decodeCanonicalBase64Url(encodedTag);
      const ciphertext = decodeCanonicalBase64Url(encodedCiphertext);
      if (initializationVector.length !== 12 || authenticationTag.length !== 16) {
        throw new SecretDecryptionError();
      }
      const decipher = createDecipheriv(ALGORITHM, this.#key, initializationVector);
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (error) {
      if (error instanceof SecretDecryptionError) throw error;
      throw new SecretDecryptionError();
    }
  }
}
