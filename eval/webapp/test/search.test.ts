import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3460;
const BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
let server: Server;
let token: string;

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
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  // Register a test user and get token
  const regRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: "password123" }),
  });
  const regData = await regRes.json();
  token = regData.token;
});

describe("Search API", () => {
  it("Search returns matching posts with headline field", async () => {
    // Create posts
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Hello World", body: "This is a test post about programming" }),
    });
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Another Post", body: "Unrelated content here" }),
    });

    const res = await fetch(`${BASE}/search?q=programming`);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Hello World");
    expect(results[0].headline).toBeDefined();
  });

  it("Search returns empty array for no matches", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Hello", body: "World" }),
    });

    const res = await fetch(`${BASE}/search?q=nonexistent`);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.length).toBe(0);
  });

  it("Search returns 400 if q param missing", async () => {
    const res = await fetch(`${BASE}/search`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Query parameter q is required");
  });

  it("Search is case-insensitive", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Programming Tips", body: "Learn to code" }),
    });

    const res = await fetch(`${BASE}/search?q=PROGRAMMING`);
    expect(res.status).toBe(200);
    const results = await res.json();
    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Programming Tips");
  });
});
