import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "crypto";

const SCRYPT_KEYLEN = 64;
const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-secret-change-in-production";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Hash a password using scrypt. Returns "salt:hash" in hex.
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
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  const storedBuf = Buffer.from(storedHash, "hex");
  return timingSafeEqual(hash, storedBuf);
}

/**
 * Generate a signed token containing userId and expiry.
 * Format: base64url(payload).base64url(signature)
 */
export function generateToken(userId: number): string {
  const payload = JSON.stringify({
    userId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
    jti: randomBytes(16).toString("hex"),
  });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a token signature and expiry. Returns { userId } or null.
 */
export function verifyToken(token: string): { userId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSig = createHmac("sha256", TOKEN_SECRET)
    .update(payloadB64)
    .digest("base64url");

  if (signature !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (!payload.userId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
