import { createHmac, randomBytes, scrypt, timingSafeEqual } from "crypto";

const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, hash) => {
      if (err) reject(err);
      else resolve(`${salt}:${hash.toString("hex")}`);
    });
  });
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else {
        try {
          resolve(timingSafeEqual(derived, Buffer.from(hash, "hex")));
        } catch {
          resolve(false);
        }
      }
    });
  });
}

export function generateToken(userId: number, role: string = "user"): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, role, exp: Date.now() + TOKEN_TTL_MS }),
  ).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof data.userId !== "number" || data.exp < Date.now()) return null;
    return { userId: data.userId, role: data.role ?? "user" };
  } catch {
    return null;
  }
}
