import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3462;
const BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let authToken: string;

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
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;
});

describe("Search API", () => {
  it("GET /api/posts/search without ?q returns 400 with error", async () => {
    const res = await fetch(`${BASE}/search`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("q is required");
  });

  it("GET /api/posts/search with empty ?q returns 400 with error", async () => {
    const res = await fetch(`${BASE}/search?q=`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("q is required");
  });

  it("GET /api/posts/search with no matching results returns []", async () => {
    const res = await fetch(`${BASE}/search?q=zzznomatchxxx`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("GET /api/posts/search returns matching posts ordered by ts_rank DESC", async () => {
    // Post with term in title ranks higher than post with term only in body
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "postgres full text search", body: "intro content here" }),
    });
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "another post about databases", body: "postgres is great" }),
    });

    const res = await fetch(`${BASE}/search?q=postgres`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length).toBe(2);
    expect(rows[0].rank).toBeGreaterThanOrEqual(rows[1].rank);
  });

  it("GET /api/posts/search includes headline with <b> tags around matched term", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Test Post", body: "This article covers postgres database usage" }),
    });

    const res = await fetch(`${BASE}/search?q=postgres`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length).toBe(1);
    expect(typeof rows[0].headline).toBe("string");
    expect(rows[0].headline).toContain("<b>");
  });

  it("GET /api/posts/search is not shadowed by /:id route", async () => {
    // 'search' must not be parsed as a post id — must get 200 or 400, never 404/500
    const res = await fetch(`${BASE}/search?q=anything`);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(500);
    expect([200, 400]).toContain(res.status);
  });
});
