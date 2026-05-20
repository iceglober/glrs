import { createHmac, scryptSync, randomBytes } from "crypto";

const TOKEN_SECRET = process.env.TOKEN_SECRET || "dev-secret-key-change-in-production";
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}.${hash.toString("hex")}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const [saltHex, hashHex] = hash.split(".");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const derived = scryptSync(password, salt, 32);
  return derived.toString("hex") === hashHex;
}

export function generateToken(userId: number, role: string = "user"): string {
  const payload = {
    userId,
    role,
    iat: Date.now(),
    exp: Date.now() + TOKEN_EXPIRY,
  };
  const json = JSON.stringify(payload);
  const hmac = createHmac("sha256", TOKEN_SECRET);
  hmac.update(json);
  const signature = hmac.digest("hex");
  const tokenData = Buffer.from(json).toString("base64url");
  return `${tokenData}.${signature}`;
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  const [tokenData, signature] = token.split(".");
  if (!tokenData || !signature) return null;

  try {
    const json = Buffer.from(tokenData, "base64url").toString();
    const payload = JSON.parse(json);

    const hmac = createHmac("sha256", TOKEN_SECRET);
    hmac.update(json);
    const expectedSignature = hmac.digest("hex");

    if (signature !== expectedSignature) return null;
    if (payload.exp < Date.now()) return null;

    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}
