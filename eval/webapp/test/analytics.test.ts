import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3459;
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
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  // Register an admin user
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "adminpass1" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;
  // Promote to admin
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminData.user.id]);
  // Re-generate token with admin role (the existing token has role='user' baked in)
  const { generateToken } = await import("../src/auth.js");
  adminToken = generateToken(adminData.user.id, "admin");

  // Register a regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regular", email: "regular@example.com", password: "userpass12" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("Analytics API - Auth", () => {
  it("GET /api/analytics/overview without auth returns 401", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("GET /api/analytics/overview with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Admin access required");
  });
});

describe("Analytics API - Overview", () => {
  it("GET /api/analytics/overview returns correct stats", async () => {
    // Seed: 2 users exist (admin + regular). Create 3 posts for admin.
    for (let i = 1; i <= 3; i++) {
      await fetch(`http://localhost:${PORT}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
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
    expect(Number(data.avg_posts_per_user)).toBeCloseTo(1.5, 1);
  });
});

describe("Analytics API - Top Authors", () => {
  it("GET /api/analytics/top-authors returns sorted array", async () => {
    // Admin creates 3 posts, regular creates 1
    for (let i = 1; i <= 3; i++) {
      await fetch(`http://localhost:${PORT}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ title: `Admin Post ${i}`, body: `Body ${i}` }),
      });
    }
    await fetch(`http://localhost:${PORT}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "User Post", body: "Content" }),
    });

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    // First entry should be the admin (3 posts)
    expect(data[0].post_count).toBe(3);
    expect(data[0].name).toBe("Admin");
    expect(data[0].user_id).toBeDefined();
    expect(data[0].email).toBe("admin@example.com");
    expect(data[0].latest_post_at).toBeDefined();
    // Second entry should be the regular user (1 post)
    expect(data[1].post_count).toBe(1);
    expect(data[1].name).toBe("Regular");
  });

  it("GET /api/analytics/top-authors?limit=1 respects limit", async () => {
    // Create posts so there are 2 authors
    await fetch(`http://localhost:${PORT}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ title: "Post A", body: "A" }),
    });
    await fetch(`http://localhost:${PORT}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Post B", body: "B" }),
    });

    const res = await fetch(`${BASE}/top-authors?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
  });
});

describe("Analytics API - Activity", () => {
  it("GET /api/analytics/activity returns 30 days by default with zero-fill", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(30);
    // Each entry has date, new_users, new_posts
    for (const entry of data) {
      expect(entry.date).toBeDefined();
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    }
    // Today should have new_users = 2 (admin + regular registered today)
    const today = new Date().toISOString().split("T")[0];
    const todayEntry = data.find((d: { date: string }) => d.date === today);
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.new_users).toBe(2);
  });

  it("GET /api/analytics/activity?days=7 limits to 7 days", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(7);
  });

  it("GET /api/analytics/activity includes zero-activity days", async () => {
    const res = await fetch(`${BASE}/activity?days=3`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(3);
    // Days before today should have 0 new_users and 0 new_posts
    const today = new Date().toISOString().split("T")[0];
    const zeroDays = data.filter((d: { date: string; new_users: number; new_posts: number }) =>
      d.date !== today
    );
    for (const day of zeroDays) {
      expect(day.new_users).toBe(0);
      expect(day.new_posts).toBe(0);
    }
  });
});
