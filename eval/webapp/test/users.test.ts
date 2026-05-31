import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3457;
const BASE = `http://localhost:${PORT}/api/users`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
let server: Server;
let token: string;
let authUserId: number;

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

afterAll(async () => { server.close(); });

beforeEach(async () => {
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  // Register a test user and get token
  const regRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: "password123" }),
  });
  const regData = await regRes.json();
  token = regData.token;
  authUserId = regData.user.id;
});

describe("Users API", () => {
  it("POST creates a user", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ name: "Alice", email: "alice@test.com" }),
    });
    expect(res.status).toBe(201);
  });

  it("GET lists users", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ name: "Bob", email: "bob@test.com" }),
    });
    const res = await fetch(BASE);
    const users = await res.json();
    // 2 users: the authenticated user + the one we just created
    expect(users.length).toBe(2);
  });

  it("GET /:id returns user", async () => {
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ name: "C", email: "c@t.com" }),
    });
    const u = await cr.json();
    const res = await fetch(`${BASE}/${u.id}`);
    expect(res.status).toBe(200);
  });

  it("GET /:id 404", async () => {
    const res = await fetch(`${BASE}/99999`);
    expect(res.status).toBe(404);
  });

  it("DELETE works", async () => {
    // Delete the authenticated user's own account
    const res = await fetch(`${BASE}/${authUserId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
  });
});
