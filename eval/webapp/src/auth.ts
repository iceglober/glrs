import { randomBytes, scrypt, createHmac, timingSafeEqual } from "node:crypto";

const AUTH_SECRET = process.env.AUTH_SECRET ?? "dev-secret";

function base64urlEncode(data: Buffer | string): string {
  const b = typeof data === "string" ? Buffer.from(data) : data;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlDecode(str: string): Buffer {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

export function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, hash) => {
      if (err) reject(err);
      else resolve(`${salt}:${hash.toString("hex")}`);
    });
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, hash) => {
      if (err) reject(err);
      else {
        try {
          resolve(timingSafeEqual(hash, Buffer.from(hashHex, "hex")));
        } catch {
          resolve(false);
        }
      }
    });
  });
}

export function generateToken(userId: number): string {
  const payload = base64urlEncode(
    JSON.stringify({ userId, exp: Date.now() + 24 * 60 * 60 * 1000 }),
  );
  const sig = base64urlEncode(
    createHmac("sha256", AUTH_SECRET).update(payload).digest(),
  );
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { userId: number } | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);

  const expectedSig = base64urlEncode(
    createHmac("sha256", AUTH_SECRET).update(payload).digest(),
  );

  try {
    const expectedBuf = base64urlDecode(expectedSig);
    const actualBuf = base64urlDecode(sig);
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(base64urlDecode(payload).toString()) as Record<string, unknown>;
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (typeof data.userId !== "number") return null;
    return { userId: data.userId };
  } catch {
    return null;
  }
}
