import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";

const scrypt = promisify(scryptCb);
const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-prod";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(derived, expected);
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

export function generateToken(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): { userId: number } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(payload) !== sig) return null;
  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof userId !== "number" || Date.now() > exp) return null;
    return { userId };
  } catch {
    return null;
  }
}
