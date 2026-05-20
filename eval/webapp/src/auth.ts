import { scryptSync, randomBytes, createHmac, timingSafeEqual } from "crypto";

const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-secret-change-in-production";
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// --- Password hashing (scrypt) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derivedHash = scryptSync(password, salt, 64).toString("hex");
  const hashBuf = Buffer.from(hash, "hex");
  const derivedBuf = Buffer.from(derivedHash, "hex");
  if (hashBuf.length !== derivedBuf.length) return false;
  return timingSafeEqual(hashBuf, derivedBuf);
}

// --- Token generation/verification (HMAC-SHA256 signed JSON) ---

export interface TokenPayload {
  userId: number;
  role: string;
  exp: number;
}

export function generateToken(userId: number, role: string): string {
  const payload: TokenPayload = {
    userId,
    role,
    exp: Date.now() + TOKEN_EXPIRY_MS,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");
  return `${payloadStr}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadStr, signature] = parts;

  // Verify signature
  const expectedSig = createHmac("sha256", TOKEN_SECRET)
    .update(payloadStr)
    .digest("base64url");

  const sigBuf = Buffer.from(signature, "base64url");
  const expectedBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  // Decode payload
  try {
    const payload = JSON.parse(
      Buffer.from(payloadStr, "base64url").toString(),
    ) as TokenPayload;

    // Check expiration
    if (payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
