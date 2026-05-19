import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
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
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  // Register admin user, then promote to admin role
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  const adminId = adminData.user.id;
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
  adminToken = generateToken(adminId, "admin");

  // Register regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("GET /api/analytics/overview", () => {
  it("returns object with numeric keys matching seeded data", async () => {
    // Alice creates 2 posts
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

    expect(data.total_users).toBe(2); // admin + alice
    expect(data.total_posts).toBe(2);
    expect(data.posts_last_7_days).toBe(2);
    expect(data.posts_last_30_days).toBe(2);
    expect(data.avg_posts_per_user).toBe(1); // 2 posts / 2 users
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when no token", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns array sorted by post_count DESC with required fields", async () => {
    // Alice creates 2 posts; Admin creates 0
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Post A", body: "Body A" }),
    });
    await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Post B", body: "Body B" }),
    });

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2); // alice + admin

    // First should be Alice with 2 posts
    expect(data[0].post_count).toBe(2);
    expect(data[0].name).toBe("Alice");

    // Sorted descending
    for (let i = 0; i < data.length - 1; i++) {
      expect(data[i].post_count).toBeGreaterThanOrEqual(data[i + 1].post_count);
    }

    // All required fields present
    for (const author of data) {
      expect(typeof author.user_id).toBe("number");
      expect(typeof author.name).toBe("string");
      expect(typeof author.email).toBe("string");
      expect(typeof author.post_count).toBe("number");
      expect("latest_post_at" in author).toBe(true);
    }
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when no token", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns 7 objects with date, new_users, new_posts (zero-filled) for ?days=7", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(7);

    for (const row of data) {
      expect(typeof row.date).toBe("string");
      expect(typeof row.new_users).toBe("number");
      expect(typeof row.new_posts).toBe("number");
    }

    // Total across all 7 days must equal seeded users
    const totalNewUsers = data.reduce((sum: number, r: { new_users: number }) => sum + r.new_users, 0);
    expect(totalNewUsers).toBe(2); // admin + alice registered today

    // At least 6 of the 7 days must be zero-filled (all seeded today)
    const zeroDays = data.filter((r: { new_users: number }) => r.new_users === 0);
    expect(zeroDays.length).toBeGreaterThanOrEqual(6);
  });

  it("returns 403 for non-admin token", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 when no token", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
  });
});
