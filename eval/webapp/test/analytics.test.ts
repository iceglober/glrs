import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3459;
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
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
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
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  // Register admin user
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminData.user.id]);

  // Register two regular users
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User", email: "user@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;

  await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User2", email: "user2@example.com", password: "password123" }),
  });

  // Admin creates 2 posts
  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
    body: JSON.stringify({ title: "Admin Post 1", body: "Content one" }),
  });
  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
    body: JSON.stringify({ title: "Admin Post 2", body: "Content two" }),
  });

  // Regular user creates 1 post
  await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
    body: JSON.stringify({ title: "User Post 1", body: "Content three" }),
  });
});

describe("GET /api/analytics/overview", () => {
  it("returns overview object with correct numeric counts for seeded data", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_users).toBe(3);
    expect(data.total_posts).toBe(3);
    expect(data.posts_last_7_days).toBe(3);
    expect(data.posts_last_30_days).toBe(3);
    expect(typeof data.avg_posts_per_user).toBe("number");
    // 3 users: admin(2), user(1), user2(0) — avg = 1.0
    expect(data.avg_posts_per_user).toBeCloseTo(1.0);
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { "Authorization": `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 for missing token", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns array sorted by post_count DESC with required fields", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(3);
    // Sorted DESC by post_count
    expect(data[0].post_count).toBe(2);
    expect(data[0].name).toBe("Admin");
    expect(data[1].post_count).toBe(1);
    expect(data[2].post_count).toBe(0);
    // Required fields present on every row
    for (const row of data) {
      expect(typeof row.user_id).toBe("number");
      expect(typeof row.name).toBe("string");
      expect(typeof row.email).toBe("string");
      expect(typeof row.post_count).toBe("number");
      // latest_post_at may be null for users with no posts
      expect("latest_post_at" in row).toBe(true);
    }
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { "Authorization": `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 for missing token", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns exactly 7 daily buckets with date, new_users, new_posts (zero-filled)", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(7);
    // Each row has required shape
    for (const row of data) {
      expect(typeof row.date).toBe("string");
      expect(typeof row.new_users).toBe("number");
      expect(typeof row.new_posts).toBe("number");
    }
    // Today (last row) has the seeded counts
    const today = data[data.length - 1];
    expect(today.new_users).toBe(3);
    expect(today.new_posts).toBe(3);
    // Earlier days are zero-filled
    for (const row of data.slice(0, -1)) {
      expect(row.new_users).toBe(0);
      expect(row.new_posts).toBe(0);
    }
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { "Authorization": `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 for missing token", async () => {
    const res = await fetch(`${BASE}/activity?days=7`);
    expect(res.status).toBe(401);
  });
});
