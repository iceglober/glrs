import { scrypt, randomBytes, createHmac } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);
const SECRET = process.env.AUTH_SECRET || "dev-secret-change-in-production";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString("base64")}:${(hash as Buffer).toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const [saltB64, hashB64] = hash.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const stored = Buffer.from(hashB64, "base64");
  const computed = await scryptAsync(password, salt, 64);
  return computed.equals(stored);
}

export function generateToken(userId: number, role: string = "user"): string {
  const payload = { userId, role, iat: Math.floor(Date.now() / 1000) };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const hmac = createHmac("sha256", SECRET);
  hmac.update(payloadB64);
  const signatureB64 = hmac.digest("base64url");
  return `${payloadB64}.${signatureB64}`;
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const [payloadB64, signatureB64] = token.split(".");
    if (!payloadB64 || !signatureB64) return null;

    const hmac = createHmac("sha256", SECRET);
    hmac.update(payloadB64);
    const expected = hmac.digest("base64url");
    if (expected !== signatureB64) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString(),
    );
    if (!payload.userId || typeof payload.userId !== "number") return null;
    if (!payload.role || typeof payload.role !== "string") return null;

    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}
