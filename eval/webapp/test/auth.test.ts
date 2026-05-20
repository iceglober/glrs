import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3458; // Distinct port for auth tests
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
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
});

describe("Auth utilities", () => {
  it("hashPassword/verifyPassword round-trip succeeds", () => {
    const password = "securepass123";
    const hashed = hashPassword(password);
    expect(verifyPassword(password, hashed)).toBe(true);
  });

  it("verifyPassword fails for wrong password", () => {
    const hashed = hashPassword("correct-password");
    expect(verifyPassword("wrong-password", hashed)).toBe(false);
  });

  it("generateToken/verifyToken round-trip succeeds", () => {
    const token = generateToken(42, "user");
    const payload = verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(42);
    expect(payload!.role).toBe("user");
  });

  it("verifyToken rejects tampered token", () => {
    const token = generateToken(42, "user");
    // Tamper with the payload portion
    const tampered = "dGFtcGVyZWQ" + token.slice(10);
    expect(verifyToken(tampered)).toBeNull();
  });

  it("verifyToken rejects malformed token", () => {
    expect(verifyToken("not.a.valid.token")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("singlepart")).toBeNull();
  });
});

describe("POST /api/auth/register", () => {
  it("registers a user and returns 201 with user and token", async () => {
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
    // password_hash should NOT be in the response
    expect(data.user.password_hash).toBeUndefined();
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
      body: JSON.stringify({ name: "Bob", email: "dup@example.com", password: "password456" }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("email already registered");
  });

  it("returns 400 for password shorter than 8 characters", async () => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Short", email: "short@example.com", password: "abc" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("at least 8 characters");
  });

  it("returns 400 for missing fields", async () => {
    const res = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "no-name@example.com", password: "password123" }),
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
      body: JSON.stringify({ name: "Carol", email: "carol@example.com", password: "mypassword1" }),
    });

    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "carol@example.com", password: "mypassword1" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe("Carol");
    expect(data.user.email).toBe("carol@example.com");
    expect(data.user.role).toBe("user");
    expect(data.token).toBeDefined();
    // password_hash should NOT be in the response
    expect(data.user.password_hash).toBeUndefined();
  });

  it("returns 401 for wrong password", async () => {
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dave", email: "dave@example.com", password: "realpassword" }),
    });

    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dave@example.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("invalid credentials");
  });

  it("returns 401 for non-existent email", async () => {
    const res = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ghost@example.com", password: "anything" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("Token authentication on protected endpoint", () => {
  it("token from register works on a protected endpoint", async () => {
    const regRes = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Eve", email: "eve@example.com", password: "evepassword" }),
    });
    const { token } = await regRes.json();

    // Use token to create a user (POST /api/users requires auth)
    const createRes = await fetch(USERS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: "NewUser", email: "new@example.com" }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.name).toBe("NewUser");
  });

  it("token from login works on a protected endpoint", async () => {
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Frank", email: "frank@example.com", password: "frankpass1" }),
    });

    const loginRes = await fetch(`${AUTH_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "frank@example.com", password: "frankpass1" }),
    });
    const { token } = await loginRes.json();

    const createRes = await fetch(USERS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: "AnotherUser", email: "another@example.com" }),
    });
    expect(createRes.status).toBe(201);
  });
});
