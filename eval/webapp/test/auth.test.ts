import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";

import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
} from "../src/auth.js";

function base64urlEncode(data: Buffer | string): string {
  const b = typeof data === "string" ? Buffer.from(data) : data;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

describe("hashPassword", () => {
  it("returns salt:hash format", async () => {
    const result = await hashPassword("mypassword");
    const parts = result.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[0-9a-f]+$/);
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
  });
});

describe("verifyPassword", () => {
  it("returns true for correct password", async () => {
    const stored = await hashPassword("correcthorsebatterystaple");
    expect(await verifyPassword("correcthorsebatterystaple", stored)).toBe(true);
  });

  it("returns false for wrong password", async () => {
    const stored = await hashPassword("correcthorsebatterystaple");
    expect(await verifyPassword("wrongpassword", stored)).toBe(false);
  });
});

describe("generateToken / verifyToken", () => {
  it("round-trips a userId", () => {
    const token = generateToken(42);
    const result = verifyToken(token);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe(42);
  });

  it("returns null for tampered signature", () => {
    const token = generateToken(1);
    const [payload] = token.split(".");
    const tampered = `${payload}.invalidsignature`;
    expect(verifyToken(tampered)).toBeNull();
  });

  it("returns null for expired token", () => {
    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const payload = base64urlEncode(
      JSON.stringify({ userId: 1, exp: Date.now() - 1000 }),
    );
    const sig = base64urlEncode(
      createHmac("sha256", secret).update(payload).digest(),
    );
    expect(verifyToken(`${payload}.${sig}`)).toBeNull();
  });
});
