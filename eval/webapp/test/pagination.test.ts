import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3461;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
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

describe("Pagination API", () => {
  it("GET /api/posts returns envelope format {data, next_cursor, has_more}", async () => {
    const res = await fetch(POSTS_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("next_cursor");
    expect(body).toHaveProperty("has_more");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /api/posts with limit=2 returns 2 items and next_cursor", async () => {
    // Create 5 posts
    for (let i = 0; i < 5; i++) {
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }

    const res = await fetch(`${POSTS_BASE}?limit=2`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    expect(body.next_cursor).not.toBeNull();
    expect(body.has_more).toBe(true);
  });

  it("GET /api/posts with cursor returns next page", async () => {
    // Create 5 posts
    for (let i = 0; i < 5; i++) {
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }

    // Get first page
    const firstRes = await fetch(`${POSTS_BASE}?limit=2`);
    const firstBody = await firstRes.json();
    expect(firstBody.data.length).toBe(2);
    expect(firstBody.has_more).toBe(true);

    // Get second page using cursor
    const secondRes = await fetch(`${POSTS_BASE}?limit=2&cursor=${firstBody.next_cursor}`);
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.data.length).toBe(2);

    // Verify pages don't overlap
    const firstIds = firstBody.data.map((p: any) => p.id);
    const secondIds = secondBody.data.map((p: any) => p.id);
    for (const id of firstIds) {
      expect(secondIds).not.toContain(id);
    }
  });

  it("GET /api/users returns envelope format", async () => {
    const res = await fetch(USERS_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("next_cursor");
    expect(body).toHaveProperty("has_more");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /api/users with cursor pagination works", async () => {
    // Create additional users (one already exists from registration)
    for (let i = 0; i < 3; i++) {
      await fetch(USERS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ name: `User ${i}`, email: `user${i}@test.com` }),
      });
    }

    // Get first page
    const firstRes = await fetch(`${USERS_BASE}?limit=2`);
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json();
    expect(firstBody.data.length).toBe(2);
    expect(firstBody.has_more).toBe(true);
    expect(firstBody.next_cursor).not.toBeNull();

    // Get second page
    const secondRes = await fetch(`${USERS_BASE}?limit=2&cursor=${firstBody.next_cursor}`);
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json();
    expect(secondBody.data.length).toBe(2);

    // Verify pages don't overlap
    const firstIds = firstBody.data.map((u: any) => u.id);
    const secondIds = secondBody.data.map((u: any) => u.id);
    for (const id of firstIds) {
      expect(secondIds).not.toContain(id);
    }
  });
});
