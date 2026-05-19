import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import { app } from "../src/app.js";
import { pool } from "../src/db.js";
import type { Server } from "http";

const PORT = 3459;
const AUTH = `http://localhost:${PORT}/api/auth`;

let server: Server;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
});

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

describe("POST /api/auth/register", () => {
  it("returns 201 with {user, token} and does not expose password_hash", async () => {
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "hunter12" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { user: Record<string, unknown>; token: string };
    expect(typeof body.token).toBe("string");
    expect(body.user.id).toBeDefined();
    expect(body.user.name).toBe("Alice");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.role).toBe("user");
    expect(body.user.password_hash).toBeUndefined();
  });

  it("returns 409 for duplicate email", async () => {
    const payload = { name: "Alice", email: "alice@example.com", password: "hunter12" };
    await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 for password shorter than 8 characters", async () => {
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "short" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await fetch(`${AUTH}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", password: "password1" }),
    });
  });

  it("returns 200 with {user, token} and inserts a session row", async () => {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "password1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { user: Record<string, unknown>; token: string };
    expect(typeof body.token).toBe("string");
    expect(body.user.email).toBe("carol@example.com");
    expect(body.user.role).toBe("user");
    expect(body.user.password_hash).toBeUndefined();
    const { rows } = await pool.query("SELECT * FROM sessions WHERE token = $1", [body.token]);
    expect(rows.length).toBe(1);
  });

  it("returns 401 for unknown email", async () => {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for wrong password", async () => {
    const res = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "wrongpass" }),
    });
    expect(res.status).toBe(401);
  });

  it("returned token round-trips through verifyToken to the user's id", async () => {
    const loginRes = await fetch(`${AUTH}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "password1" }),
    });
    const { user, token } = await loginRes.json() as { user: { id: number }; token: string };
    const decoded = verifyToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(user.id);
  });
});
