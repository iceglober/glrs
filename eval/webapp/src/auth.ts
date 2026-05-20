import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "crypto";

const SCRYPT_KEYLEN = 64;
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? "dev-secret-change-in-production";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Hash a password using scrypt with a random salt.
 * Returns "salt:hash" (both hex-encoded).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (storedBuf.length !== hashBuf.length) return false;
  return timingSafeEqual(storedBuf, hashBuf);
}

/**
 * Generate an HMAC-SHA256 signed token.
 * Format: base64url(payload).base64url(signature)
 */
export function generateToken(userId: number, role: string): string {
  const payload = {
    userId,
    role,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
    jti: randomBytes(16).toString("hex"),
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

export interface TokenPayload {
  userId: number;
  role: string;
  exp: number;
}

/**
 * Verify and decode a token. Returns the payload if valid, null otherwise.
 */
export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, providedSig] = parts;
  if (!payloadStr || !providedSig) return null;

  const expectedSig = createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  // Timing-safe comparison of signatures
  const sigBuf = Buffer.from(providedSig, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString(),
    ) as TokenPayload;

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}
