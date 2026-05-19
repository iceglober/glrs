import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { createHmac } from "crypto";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

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

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
});

// Helper to sign an arbitrary payload with the same secret auth.ts uses
function signToken(payload: object): string {
  const secret = process.env.AUTH_SECRET ?? "dev-secret-change-in-production";
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

describe("Migration", () => {
  it("users table has password_hash and role columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN ('password_hash', 'role')
      ORDER BY column_name
    `);
    const names = rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain("password_hash");
    expect(names).toContain("role");
    const roleRow = rows.find((r: { column_name: string }) => r.column_name === "role");
    expect(roleRow.column_default).toContain("user");
  });

  it("sessions table has required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'sessions'
      ORDER BY column_name
    `);
    const names = rows.map((r: { column_name: string }) => r.column_name);
    expect(names).toContain("id");
    expect(names).toContain("user_id");
    expect(names).toContain("token");
    expect(names).toContain("expires_at");
    expect(names).toContain("created_at");
  });

  it("sessions table has foreign key to users with cascade", async () => {
    const { rows } = await pool.query(`
      SELECT tc.constraint_type, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.referential_constraints rc
        ON tc.constraint_name = rc.constraint_name
      WHERE tc.table_name = 'sessions' AND tc.constraint_type = 'FOREIGN KEY'
    `);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].delete_rule).toBe("CASCADE");
  });
});

describe("Auth utilities", () => {
  it("hashPassword produces salt:hash format", async () => {
    const hash = await hashPassword("password123");
    const parts = hash.split(":");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[a-f0-9]+$/);
    expect(parts[1]).toMatch(/^[a-f0-9]+$/);
  });

  it("verifyPassword returns true for correct password", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", hash)).toBe(true);
  });

  it("verifyPassword returns false for wrong password", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("wrongpassword", hash)).toBe(false);
  });

  it("generateToken + verifyToken roundtrip yields {userId}", () => {
    const token = generateToken(42);
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(42);
  });

  it("verifyToken returns null for tampered token", () => {
    const token = generateToken(42);
    const [payloadB64, sig] = token.split(".");
    const tampered = `${payloadB64}.${sig.slice(0, -4)}XXXX`;
    expect(verifyToken(tampered)).toBeNull();
  });

  it("verifyToken returns null for expired token", () => {
    const expired = signToken({ userId: 42, exp: Date.now() - 1000 });
    expect(verifyToken(expired)).toBeNull();
  });
});

describe("POST /api/auth/register", () => {
  it("returns 201 with user and token on valid input", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.id).toBeDefined();
    expect(body.user.name).toBe("Alice");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.role).toBe("user");
    expect(body.user.password_hash).toBeUndefined();
    expect(typeof body.token).toBe("string");
  });

  it("returns 409 on duplicate email", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
    });
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice2", email: "alice@example.com", password: "password456" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 400 if password is less than 8 characters", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "short" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
    });
  });

  it("returns user and token on correct credentials and inserts a session", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.role).toBe("user");
    expect(body.user.password_hash).toBeUndefined();
    expect(typeof body.token).toBe("string");

    const { rows } = await pool.query("SELECT * FROM sessions");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("returns 401 on wrong password", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 on unknown email", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
  });
});
