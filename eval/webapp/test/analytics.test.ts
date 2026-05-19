import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3460;
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;

let server: Server;
let adminToken: string;
let userToken: string;

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
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  // Elevate to admin; the role is fetched from DB at request time, not encoded in the token
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminData.user.id]);
  adminToken = adminData.token;

  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User", email: "user@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("GET /api/analytics/overview", () => {
  it("returns object with correct numeric counts matching seeded data", async () => {
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Post 1", body: "Body 1" }),
    });
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Post 2", body: "Body 2" }),
    });

    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(typeof data.total_users).toBe("number");
    expect(typeof data.total_posts).toBe("number");
    expect(typeof data.posts_last_7_days).toBe("number");
    expect(typeof data.posts_last_30_days).toBe("number");
    expect(typeof data.avg_posts_per_user).toBe("number");

    expect(data.total_users).toBe(2);
    expect(data.total_posts).toBe(2);
    expect(data.posts_last_7_days).toBe(2);
    expect(data.posts_last_30_days).toBe(2);
    // 2 posts across 2 users (admin has 0, user has 2) → avg = 1.0
    expect(data.avg_posts_per_user).toBe(1);
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns array sorted by post_count DESC with required fields", async () => {
    // Give userToken 2 posts, adminToken 1 post
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "User Post 1", body: "Body" }),
    });
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "User Post 2", body: "Body" }),
    });
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: "Admin Post", body: "Body" }),
    });

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const rows = await res.json();

    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Verify required fields on first entry
    expect(typeof rows[0].user_id).toBe("number");
    expect(typeof rows[0].name).toBe("string");
    expect(typeof rows[0].email).toBe("string");
    expect(typeof rows[0].post_count).toBe("number");
    expect(rows[0].latest_post_at).toBeDefined();

    // Sorted DESC by post_count
    expect(rows[0].post_count).toBe(2);
    expect(rows[0].email).toBe("user@example.com");
    expect(rows[1].post_count).toBe(1);
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns array of 7 objects with date, new_users, new_posts when ?days=7", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const rows = await res.json();

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(7);

    for (const row of rows) {
      expect(typeof row.date).toBe("string");
      expect(typeof row.new_users).toBe("number");
      expect(typeof row.new_posts).toBe("number");
    }
  });

  it("zero-fills days with no activity", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const rows = await res.json();
    // All 7 days must be present; days before today will have 0 posts
    const totalPosts = rows.reduce((sum: number, r: { new_posts: number }) => sum + r.new_posts, 0);
    // No posts created yet in this test — all zeros
    expect(totalPosts).toBe(0);
    // Today's entry should have the 2 users registered in beforeEach
    const today = rows[rows.length - 1];
    expect(today.new_users).toBeGreaterThanOrEqual(2);
  });
});

describe("Authorization", () => {
  it("non-admin token gets 403 on /overview", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("non-admin token gets 403 on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("non-admin token gets 403 on /activity", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("missing token gets 401 on /overview", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });

  it("missing token gets 401 on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });

  it("missing token gets 401 on /activity", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
  });
});
