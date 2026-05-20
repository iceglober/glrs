import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3455;
const BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;

beforeAll(async () => {
  // Run migrations
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

  // Start server
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");
});

describe("Auth API - Register", () => {
  it("POST /api/auth/register with valid credentials returns 201 with user and token", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.id).toBeDefined();
    expect(data.user.name).toBe("Alice");
    expect(data.user.email).toBe("alice@example.com");
    expect(data.user.role).toBe("user");
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe("string");
  });

  it("POST /api/auth/register with duplicate email returns 409", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        password: "password123",
      }),
    });

    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice2",
        email: "alice@example.com",
        password: "password456",
      }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/auth/register with password < 8 chars returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob",
        email: "bob@example.com",
        password: "short",
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/auth/register with missing fields returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Charlie",
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe("Auth API - Login", () => {
  beforeEach(async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        password: "password123",
      }),
    });
  });

  it("POST /api/auth/login with correct credentials returns 200 with user and token", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.id).toBeDefined();
    expect(data.user.email).toBe("alice@example.com");
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe("string");
  });

  it("POST /api/auth/login with wrong password returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "wrongpassword",
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/auth/login with unknown email returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "unknown@example.com",
        password: "password123",
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("POST /api/auth/login with missing fields returns 400", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe("Auth Utilities", () => {
  it("hashPassword and verifyPassword round-trip returns true", () => {
    const password = "mySecurePassword123";
    const hash = hashPassword(password);
    const isValid = verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it("verifyPassword with wrong password returns false", () => {
    const password = "mySecurePassword123";
    const hash = hashPassword(password);
    const isValid = verifyPassword("wrongPassword", hash);
    expect(isValid).toBe(false);
  });

  it("generateToken and verifyToken round-trip returns userId", () => {
    const userId = 42;
    const token = generateToken(userId);
    const decoded = verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded?.userId).toBe(userId);
  });

  it("verifyToken with tampered token returns null", () => {
    const userId = 42;
    const token = generateToken(userId);
    const tamperedToken = token.slice(0, -5) + "xxxxx";
    const decoded = verifyToken(tamperedToken);
    expect(decoded).toBeNull();
  });

  it("verifyToken with invalid format returns null", () => {
    const decoded = verifyToken("invalid.token.format");
    expect(decoded).toBeNull();
  });
});
