import {
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const SECRET = process.env.AUTH_SECRET ?? "dev-secret";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function base64urlEncode(data: Buffer | string): string {
  const b = typeof data === "string" ? Buffer.from(data) : data;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scryptAsync(password, salt, 64)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function generateToken(userId: number): string {
  const payload = base64urlEncode(
    JSON.stringify({ userId, exp: Date.now() + TOKEN_TTL_MS }),
  );
  const sig = base64urlEncode(
    createHmac("sha256", SECRET).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", SECRET).update(payload).digest();
  const actual = base64urlDecode(sig);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }

  let parsed: { userId: number; exp: number };
  try {
    parsed = JSON.parse(base64urlDecode(payload).toString());
  } catch {
    return null;
  }

  if (Date.now() > parsed.exp) return null;
  return { userId: parsed.userId };
}
