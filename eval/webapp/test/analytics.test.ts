import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3460;
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  // Run migrations
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

  // Start server
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  // Register an admin user
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;
  // Promote to admin
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminData.user.id]);
  // Re-generate token with admin role (the existing token has role='user')
  const loginRes = await fetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "password123" }),
  });
  const loginData = await loginRes.json();
  adminToken = loginData.token;

  // Register a regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regular", email: "regular@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("Analytics API — Auth guards", () => {
  it("GET /api/analytics/overview without auth returns 401", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });

  it("GET /api/analytics/overview with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("GET /api/analytics/top-authors without auth returns 401", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });

  it("GET /api/analytics/activity without auth returns 401", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
  });
});

describe("Analytics API — /overview", () => {
  it("returns correct aggregate stats with admin token", async () => {
    // Seed: we already have 2 users (admin + regular) from beforeEach
    // Create some posts as the regular user
    const postsBase = `http://localhost:${PORT}/api/posts`;
    for (let i = 0; i < 3; i++) {
      await fetch(postsBase, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }

    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total_users).toBe(2);
    expect(data.total_posts).toBe(3);
    expect(data.posts_last_7_days).toBe(3);
    expect(data.posts_last_30_days).toBe(3);
    // avg_posts_per_user = 3/2 = 1.5
    expect(Number(data.avg_posts_per_user)).toBeCloseTo(1.5, 1);
  });
});

describe("Analytics API — /top-authors", () => {
  it("returns authors sorted by post_count DESC", async () => {
    const postsBase = `http://localhost:${PORT}/api/posts`;
    // Regular user creates 3 posts
    for (let i = 0; i < 3; i++) {
      await fetch(postsBase, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ title: `User Post ${i}`, body: `Body ${i}` }),
      });
    }
    // Admin creates 1 post
    await fetch(postsBase, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: "Admin Post", body: "Admin body" }),
    });

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    // First entry should be Regular with 3 posts
    expect(data[0].name).toBe("Regular");
    expect(data[0].post_count).toBe(3);
    expect(data[0].user_id).toBeDefined();
    expect(data[0].email).toBe("regular@example.com");
    expect(data[0].latest_post_at).toBeDefined();
    // Second entry should be Admin with 1 post
    expect(data[1].name).toBe("Admin");
    expect(data[1].post_count).toBe(1);
  });

  it("respects the limit parameter", async () => {
    const postsBase = `http://localhost:${PORT}/api/posts`;
    await fetch(postsBase, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "P1", body: "B1" }),
    });
    await fetch(postsBase, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: "P2", body: "B2" }),
    });

    const res = await fetch(`${BASE}/top-authors?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
  });
});

describe("Analytics API — /activity", () => {
  it("returns array with date, new_users, new_posts for default 30 days", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(30);
    // Each entry has date, new_users, new_posts
    const today = data[data.length - 1];
    expect(today.date).toBeDefined();
    expect(typeof today.new_users).toBe("number");
    expect(typeof today.new_posts).toBe("number");
    // Today should have 2 new users (admin + regular registered in beforeEach)
    expect(today.new_users).toBe(2);
  });

  it("GET /api/analytics/activity?days=7 limits to 7 days", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(7);
  });

  it("includes zero-activity days filled via generate_series", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    // Days before today should have 0 users and 0 posts
    const yesterday = data[data.length - 2];
    expect(yesterday.new_users).toBe(0);
    expect(yesterday.new_posts).toBe(0);
  });
});
