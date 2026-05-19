import { scrypt, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const colonIdx = stored.indexOf(":");
    if (colonIdx === -1) return false;
    const salt = stored.slice(0, colonIdx);
    const storedHash = stored.slice(colonIdx + 1);
    const hash = (await scryptAsync(password, salt, 64)) as Buffer;
    const storedHashBuf = Buffer.from(storedHash, "hex");
    if (hash.length !== storedHashBuf.length) return false;
    return timingSafeEqual(hash, storedHashBuf);
  } catch {
    return false;
  }
}

function getSecret(): string {
  return process.env.AUTH_SECRET ?? "dev-secret";
}

export function generateToken(userId: number): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + 24 * 60 * 60 * 1000 });
  const encodedPayload = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const encodedPayload = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!encodedPayload || !sig) return null;

    const expectedSig = createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedSigBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedSigBuf.length || !timingSafeEqual(sigBuf, expectedSigBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    if (typeof payload.userId !== "number") return null;

    return { userId: payload.userId };
  } catch {
    return null;
  }
}
