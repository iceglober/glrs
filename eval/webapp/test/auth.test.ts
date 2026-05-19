import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
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
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");
});

describe("Auth utilities", () => {
  it("hashPassword/verifyPassword round-trip returns true", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("mypassword", hash)).toBe(true);
  });

  it("verifyPassword with wrong password returns false", async () => {
    const hash = await hashPassword("mypassword");
    expect(await verifyPassword("wrongpassword", hash)).toBe(false);
  });

  it("verifyToken(generateToken(userId)) returns {userId}", () => {
    const token = generateToken(42);
    const result = verifyToken(token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe(42);
  });
});

describe("POST /api/auth/register", () => {
  it("valid registration returns 201 with {user:{id,name,email,role},token}", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.id).toBeDefined();
    expect(data.user.name).toBe("Alice");
    expect(data.user.email).toBe("alice@example.com");
    expect(data.user.role).toBe("user");
    expect(typeof data.token).toBe("string");
  });

  it("duplicate email returns 409", async () => {
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

  it("password shorter than 8 chars returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "short" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", password: "password123" }),
    });
  });

  it("correct credentials returns 200 with {user,token}", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBeDefined();
    expect(data.user.name).toBe("Carol");
    expect(data.user.email).toBe("carol@example.com");
    expect(typeof data.token).toBe("string");
  });

  it("wrong password returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
  });

  it("unknown email returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@example.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
  });
});
