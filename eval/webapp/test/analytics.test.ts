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
let adminUserId: number;
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
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  // Register admin user and elevate role
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;
  adminUserId = adminData.user.id;
  // role is read fresh from DB on each request — just update DB, same token works
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminUserId]);

  // Register regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User", email: "user@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("Analytics - auth guards", () => {
  it("GET /overview without token returns 401", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });

  it("GET /overview with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("GET /top-authors without token returns 401", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });

  it("GET /top-authors with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("GET /activity without token returns 401", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
  });

  it("GET /activity with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("Analytics - overview", () => {
  it("returns all required keys", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("total_users");
    expect(data).toHaveProperty("total_posts");
    expect(data).toHaveProperty("posts_last_7_days");
    expect(data).toHaveProperty("posts_last_30_days");
    expect(data).toHaveProperty("avg_posts_per_user");
  });

  it("returns correct counts matching seeded data", async () => {
    // beforeEach created 2 users (admin + regular); add 1 more → 3 total
    await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Third", email: "third@example.com", password: "password123" }),
    });

    // Create 6 posts via the regular user
    for (let i = 0; i < 6; i++) {
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }

    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    expect(data.total_users).toBe(3);
    expect(data.total_posts).toBe(6);
    expect(data.posts_last_7_days).toBe(6);
    expect(data.posts_last_30_days).toBe(6);
    expect(Number(data.avg_posts_per_user)).toBe(2); // 6/3 = 2.0
  });
});

describe("Analytics - top-authors", () => {
  it("returns array with required shape per element", async () => {
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "A post", body: "Some body" }),
    });

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    const first = data[0];
    expect(first).toHaveProperty("user_id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("email");
    expect(first).toHaveProperty("post_count");
    expect(first).toHaveProperty("latest_post_at");
  });

  it("?limit=2 returns at most 2 results", async () => {
    const res = await fetch(`${BASE}/top-authors?limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(2);
  });

  it("results sorted by post_count DESC and top author is correct", async () => {
    // Create 3 posts for regular user and 1 for admin
    for (let i = 0; i < 3; i++) {
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: "Admin post", body: "Admin body" }),
    });

    const res = await fetch(`${BASE}/top-authors?limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    expect(data.length).toBeLessThanOrEqual(2);
    // User with 3 posts should be first
    expect(data[0].post_count).toBe(3);
    expect(data[0].email).toBe("user@example.com");
    // Sorted descending
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].post_count).toBeGreaterThanOrEqual(data[i].post_count);
    }
  });
});

describe("Analytics - activity", () => {
  it("?days=7 returns exactly 7 entries", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(7);
  });

  it("each entry has date, new_users (number), new_posts (number)", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    for (const entry of data) {
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    }
  });

  it("past days with no activity show new_users=0 and new_posts=0", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    // All 7 entries except today should have no posts (posts are only created today)
    const pastEntries = data.filter((e: { date: string }) => e.date < today);
    for (const entry of pastEntries) {
      expect(entry.new_users).toBe(0);
      expect(entry.new_posts).toBe(0);
    }
  });

  it("dates are in ascending order and the last entry is today", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    expect(data).toHaveLength(7);
    for (let i = 1; i < data.length; i++) {
      expect(data[i].date > data[i - 1].date).toBe(true);
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(data[6].date).toBe(today);
  });

  it("today's entry reflects registered users in beforeEach", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    const todayEntry = data.find((e: { date: string }) => e.date === today);
    // admin + regular user registered in beforeEach
    expect(todayEntry).toBeDefined();
    expect(todayEntry.new_users).toBeGreaterThanOrEqual(2);
  });
});
