import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3459;
const BASE = `http://localhost:${PORT}/api/auth`;
let server: Server;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()) {
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
  await pool.query("TRUNCATE sessions RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
});

describe("Auth API", () => {
  it("POST /register - success returns 201 with user and token", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@test.com", password: "password123" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe("Alice");
    expect(data.user.email).toBe("alice@test.com");
    expect(data.user.role).toBe("user");
    expect(data.token).toBeDefined();
  });

  it("POST /register - duplicate email returns 409", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@test.com", password: "password123" }),
    });
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice2", email: "alice@test.com", password: "password456" }),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Email already registered");
  });

  it("POST /register - short password returns 400", async () => {
    const res = await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bob", email: "bob@test.com", password: "short" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Password must be at least 8 characters");
  });

  it("POST /login - success returns 200 with user and token", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Charlie", email: "charlie@test.com", password: "password123" }),
    });
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "charlie@test.com", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe("Charlie");
    expect(data.user.email).toBe("charlie@test.com");
    expect(data.token).toBeDefined();
  });

  it("POST /login - wrong password returns 401", async () => {
    await fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dana", email: "dana@test.com", password: "password123" }),
    });
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dana@test.com", password: "wrongpassword" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid credentials");
  });

  it("POST /login - unknown email returns 401", async () => {
    const res = await fetch(`${BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "unknown@test.com", password: "password123" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Invalid credentials");
  });
});
