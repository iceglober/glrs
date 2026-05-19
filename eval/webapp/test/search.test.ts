import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3461;
const BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let authToken: string;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
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

async function createPost(title: string, body: string) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ title, body }),
  });
  return res.json();
}

describe("GET /api/posts/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await fetch(`${BASE}/search`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns empty array when no posts match the query", async () => {
    await createPost("Hello world", "This is a test post");
    const res = await fetch(`${BASE}/search?q=xyznonexistent`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns matching posts with headline containing <b> markers", async () => {
    await createPost("Postgres full-text search", "Postgres supports tsvector for indexing");
    const res = await fetch(`${BASE}/search?q=tsvector`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].headline).toBeDefined();
    expect(body[0].headline).toContain("<b>");
  });

  it("orders results by ts_rank descending", async () => {
    await createPost("Postgres", "Postgres Postgres Postgres search");
    await createPost("Other", "Just mentions search once");
    const res = await fetch(`${BASE}/search?q=search`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    const ranks = body.map((r: { rank: number }) => r.rank);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]).toBeGreaterThanOrEqual(ranks[i]);
    }
  });
});
