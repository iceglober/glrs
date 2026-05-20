import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3459;
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
  await pool.query("TRUNCATE sessions RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");
});

describe("Token utilities", () => {
  it("verifyToken(generateToken(userId)) returns { userId }", () => {
    const token = generateToken(42);
    const result = verifyToken(token);
    expect(result).toEqual({ userId: 42 });
  });

  it("verifyToken with tampered token returns null", () => {
    const token = generateToken(42);
    const tampered = token.slice(0, -1) + "x";
    expect(verifyToken(tampered)).toBeNull();
  });

  it("verifyToken with garbage returns null", () => {
    expect(verifyToken("not.a.valid.token")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("singlepart")).toBeNull();
  });
});

describe("Password utilities", () => {
  it("hashPassword/verifyPassword round-trip returns true", () => {
    const hash = hashPassword("mypassword123");
    expect(verifyPassword("mypassword123", hash)).toBe(true);
  });

  it("wrong password returns false", () => {
    const hash = hashPassword("correct-password");
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("POST /api/auth/register", () => {
  it("with valid data returns 201 with { user: { id, name, email, role }, token }", async () => {
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
    expect(data.token.length).toBeGreaterThan(0);
  });

  it("duplicate email returns 409", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "dup@example.com", password: "password123" }),
    });
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice2", email: "dup@example.com", password: "password456" }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Email already registered");
  });

  it("password < 8 chars returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Short", email: "short@example.com", password: "1234567" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Password must be at least 8 characters");
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    // Register a user to test login against
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
    });
  });

  it("with correct credentials returns 200 with { user, token }", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.name).toBe("Bob");
    expect(data.user.email).toBe("bob@example.com");
    expect(data.user.role).toBe("user");
    expect(typeof data.token).toBe("string");
    expect(data.token.length).toBeGreaterThan(0);
  });

  it("wrong password returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid credentials");
  });

  it("unknown email returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid credentials");
  });
});
