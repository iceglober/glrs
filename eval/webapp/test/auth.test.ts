import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createHmac } from "node:crypto";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

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

describe("Auth API endpoints", () => {
  const PORT = 3459;
  const BASE = `http://localhost:${PORT}/api/auth`;
  let server: Server;

  beforeAll(async () => {
    const { readdirSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const migrationsDir = join(import.meta.dir, "..", "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
    }
    server = app.listen(PORT);
    await new Promise<void>((resolve) => server.on("listening", resolve));
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
  });

  it("POST /register returns 201 with user and token", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password1" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.id).toBeDefined();
    expect(body.user.name).toBe("Alice");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.role).toBe("user");
    expect(typeof body.token).toBe("string");
  });

  it("POST /register with duplicate email returns 409", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password1" }),
    });
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice2", email: "alice@example.com", password: "password2" }),
    });
    expect(res.status).toBe(409);
  });

  it("POST /register with password length 7 returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "short1!" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /login with correct credentials returns 200 with user and token", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", password: "mypassword" }),
    });
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "mypassword" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("carol@example.com");
    expect(typeof body.token).toBe("string");
  });

  it("POST /login with wrong password returns 401", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dave", email: "dave@example.com", password: "correctpass" }),
    });
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dave@example.com", password: "wrongpass1" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /login with unknown email returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "somepassword" }),
    });
    expect(res.status).toBe(401);
  });
});
