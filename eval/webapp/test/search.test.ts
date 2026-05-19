import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3462;
const SEARCH_BASE = `http://localhost:${PORT}/api/posts/search`;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;
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

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;

  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
    body: JSON.stringify({ title: "JavaScript Tutorial", body: "Learn JavaScript programming language basics" }),
  });
  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
    body: JSON.stringify({ title: "Python Guide", body: "Python is a powerful programming language" }),
  });
  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
    body: JSON.stringify({ title: "Database Design", body: "Understanding relational databases and SQL queries" }),
  });
});

describe("GET /api/posts/search", () => {
  it("returns matching posts with rank and headline containing <b> markers", async () => {
    const res = await fetch(`${SEARCH_BASE}?q=javascript`);
    expect(res.status).toBe(200);
    const posts = await res.json();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].title).toBe("JavaScript Tutorial");
    expect(typeof posts[0].rank).toBe("number");
    expect(posts[0].headline).toBeTruthy();
    expect(posts[0].headline).toContain("<b>");
  });

  it("returns multiple results ordered by ts_rank desc", async () => {
    const res = await fetch(`${SEARCH_BASE}?q=programming`);
    expect(res.status).toBe(200);
    const posts = await res.json();
    expect(posts.length).toBe(2);
    expect(posts[0].rank).toBeGreaterThanOrEqual(posts[1].rank);
  });

  it("returns empty array for non-matching query", async () => {
    const res = await fetch(`${SEARCH_BASE}?q=cooking`);
    expect(res.status).toBe(200);
    const posts = await res.json();
    expect(posts).toEqual([]);
  });

  it("returns 400 with error body when q is missing", async () => {
    const res = await fetch(SEARCH_BASE);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});
