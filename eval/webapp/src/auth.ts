import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb);
const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-secret-change-in-production";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const storedBuf = Buffer.from(hash, "hex");
  return candidate.length === storedBuf.length && timingSafeEqual(candidate, storedBuf);
}

export function generateToken(userId: number): string {
  const payload = { userId, exp: Date.now() + 24 * 60 * 60 * 1000 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const payloadB64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const expectedSig = createHmac("sha256", AUTH_SECRET).update(payloadB64).digest("base64url");
  const expectedBuf = Buffer.from(expectedSig);
  const actualBuf = Buffer.from(sig);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    return null;
  }

  let payload: { userId: number; exp: number };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    return null;
  }

  if (payload.exp < Date.now()) return null;
  return { userId: payload.userId };
}
