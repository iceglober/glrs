import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.AUTH_SECRET ?? "dev-secret-do-not-use-in-prod";
const TOKEN_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Hash a plaintext password using scrypt with a random salt.
 * Format: salt:hash (both hex-encoded).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Verify a plaintext password against a stored salt:hash string.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(":");
  if (!salt || !storedHash) return false;
  const hash = scryptSync(password, salt, 64).toString("hex");
  const storedBuf = Buffer.from(storedHash, "hex");
  const hashBuf = Buffer.from(hash, "hex");
  if (storedBuf.length !== hashBuf.length) return false;
  return timingSafeEqual(storedBuf, hashBuf);
}

/**
 * Generate a signed token containing the userId and expiry.
 * Format: base64url(payload).base64url(signature)
 */
export function generateToken(userId: number): string {
  const payload = JSON.stringify({
    userId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  });
  const payloadB64 = Buffer.from(payload).toString("base64url");
  const signature = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a token's signature and expiry.
 * Returns { userId } on success, or null if invalid/expired.
 */
export function verifyToken(token: string): { userId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  const expectedSig = createHmac("sha256", SECRET).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (!payload.userId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
