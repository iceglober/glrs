import { describe, it, expect } from "bun:test";
import { createHmac } from "node:crypto";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";

describe("hashPassword / verifyPassword", () => {
  it("returns salt:hash format with non-empty parts", async () => {
    const stored = await hashPassword("secret");
    const colonIdx = stored.indexOf(":");
    expect(colonIdx).toBeGreaterThan(0);
    const salt = stored.slice(0, colonIdx);
    const hash = stored.slice(colonIdx + 1);
    expect(salt.length).toBeGreaterThan(0);
    expect(hash.length).toBeGreaterThan(0);
  });

  it("two calls with the same password yield different stored values (random salt)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifyPassword returns true for the original password", async () => {
    const stored = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", stored)).toBe(true);
  });

  it("verifyPassword returns false for a wrong password", async () => {
    const stored = await hashPassword("mypassword");
    expect(await verifyPassword("wrongpassword", stored)).toBe(false);
  });
});

describe("generateToken / verifyToken", () => {
  it("round-trip: verifyToken decodes back to userId", () => {
    const token = generateToken(42);
    const result = verifyToken(token);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe(42);
  });

  it("verifyToken returns null for a tampered signature", () => {
    const token = generateToken(1);
    const dotIdx = token.lastIndexOf(".");
    const tampered = token.slice(0, dotIdx + 1) + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(verifyToken(tampered)).toBeNull();
  });

  it("verifyToken returns null for an expired token", () => {
    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const payload = JSON.stringify({ userId: 1, exp: Date.now() - 1000 });
    const encodedPayload = Buffer.from(payload).toString("base64url");
    const sig = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
    const expiredToken = `${encodedPayload}.${sig}`;
    expect(verifyToken(expiredToken)).toBeNull();
  });

  it("verifyToken returns null for malformed input", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("a.b.c")).toBeNull();
    expect(verifyToken("only-one-part")).toBeNull();
  });

  it("token signed with a different AUTH_SECRET fails under the default secret", () => {
    const savedSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "custom-secret-xyz";
    const token = generateToken(99);
    delete process.env.AUTH_SECRET;
    expect(verifyToken(token)).toBeNull();
    if (savedSecret !== undefined) process.env.AUTH_SECRET = savedSecret;
  });
});
