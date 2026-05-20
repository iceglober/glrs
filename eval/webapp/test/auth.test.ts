import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3459;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;

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
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
});

describe("Auth utilities", () => {
  it("hashPassword/verifyPassword round-trip succeeds", () => {
    const password = "mysecretpassword";
    const hashed = hashPassword(password);
    expect(verifyPassword(password, hashed)).toBe(true);
  });

  it("verifyPassword rejects wrong password", () => {
    const hashed = hashPassword("correct");
    expect(verifyPassword("wrong", hashed)).toBe(false);
  });

  it("hashPassword produces different hashes for same password (random salt)", () => {
    const h1 = hashPassword("same");
    const h2 = hashPassword("same");
    expect(h1).not.toBe(h2);
  });

  it("generateToken/verifyToken round-trip succeeds", () => {
    const token = generateToken(42, "user");
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(42);
    expect(payload!.role).toBe("user");
    expect(payload!.exp).toBeGreaterThan(Date.now());
  });

  it("verifyToken rejects tampered token", () => {
    const token = generateToken(1, "user");
    // Tamper with the payload part
    const tampered = "dGFtcGVyZWQ." + token.split(".")[1];
    expect(verifyToken(tampered)).toBeNull();
  });

  it("verifyToken rejects malformed tokens", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("a.b.c")).toBeNull();
  });
});

describe("POST /api/auth/register", () => {
  it("registers a new user and returns 201 with user and token", async () => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
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

  it("returns 409 for duplicate email", async () => {
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "dup@example.com", password: "password123" }),
    });

    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice2", email: "dup@example.com", password: "password456" }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("email");
  });

  it("returns 400 for password shorter than 8 characters", async () => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Short", email: "short@example.com", password: "1234567" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("8 characters");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "missing@example.com", password: "password123" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials and returns 200 with user and token", async () => {
    // First register
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
    });

    // Then login
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe("Bob");
    expect(data.user.email).toBe("bob@example.com");
    expect(data.user.role).toBe("user");
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe("string");
    // Should not return password_hash
    expect(data.user.password_hash).toBeUndefined();
  });

  it("returns 401 for wrong password", async () => {
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", password: "password123" }),
    });

    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toContain("invalid");
  });

  it("returns 401 for non-existent email", async () => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("Token-based authentication on protected endpoints", () => {
  it("returned token works on a protected endpoint", async () => {
    // Register and get token
    const regRes = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dave", email: "dave@example.com", password: "password123" }),
    });
    const { token } = await regRes.json();

    // Use token to create a user (protected endpoint)
    const res = await fetch(USERS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: "NewUser", email: "new@example.com" }),
    });
    expect(res.status).toBe(201);
    const user = await res.json();
    expect(user.name).toBe("NewUser");
  });

  it("invalid token is rejected on protected endpoints", async () => {
    const res = await fetch(USERS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid.token",
      },
      body: JSON.stringify({ name: "Fail", email: "fail@example.com" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("missing Authorization header is rejected", async () => {
    const res = await fetch(USERS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fail", email: "fail@example.com" }),
    });
    expect(res.status).toBe(401);
  });
});
