import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3459;
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let adminToken: string;
let adminUserId: number;
let userToken: string;
let userId: number;

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
  await pool.query("TRUNCATE posts, sessions, users RESTART IDENTITY CASCADE");

  // Create admin user
  const { rows: adminRows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ["Admin User", "admin@example.com", "dummy_hash", "admin"],
  );
  adminUserId = adminRows[0].id;
  adminToken = generateToken(adminUserId, "admin");

  // Create regular user
  const { rows: userRows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ["Regular User", "user@example.com", "dummy_hash", "user"],
  );
  userId = userRows[0].id;
  userToken = generateToken(userId, "user");

  // Seed posts from different dates
  const now = new Date();

  // Posts from last 7 days (5 posts)
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 1", "Body 1", adminUserId, new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 2", "Body 2", adminUserId, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 3", "Body 3", userId, new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 4", "Body 4", userId, new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 5", "Body 5", adminUserId, new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)],
  );

  // Posts from 8-30 days ago (3 additional posts, total 8 in last 30 days)
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 6", "Body 6", userId, new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 7", "Body 7", adminUserId, new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000)],
  );
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 8", "Body 8", userId, new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000)],
  );

  // Post from 31+ days ago (1 total posts, not in last 30)
  await pool.query(
    `INSERT INTO posts (title, body, user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["Post 9", "Body 9", adminUserId, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)],
  );
});

describe("Analytics API - Overview", () => {
  it("GET /api/analytics/overview returns overview stats with correct values", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
    expect(typeof data.total_users).toBe("number");
    expect(data.total_users).toBe(2);
    expect(typeof data.total_posts).toBe("number");
    expect(data.total_posts).toBe(9);
    expect(typeof data.posts_last_7_days).toBe("number");
    expect(data.posts_last_7_days).toBe(5);
    expect(typeof data.posts_last_30_days).toBe("number");
    expect(data.posts_last_30_days).toBe(8);
    expect(typeof data.avg_posts_per_user).toBe("number");
    expect(data.avg_posts_per_user).toBe(4.5);
  });

  it("GET /api/analytics/overview with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET /api/analytics/overview without token returns 401", async () => {
    const res = await fetch(`${BASE}/overview`);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

describe("Analytics API - Top Authors", () => {
  it("GET /api/analytics/top-authors returns authors sorted by post_count DESC", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);

    // First author (admin) should have 5 posts
    expect(data[0].user_id).toBe(adminUserId);
    expect(data[0].name).toBe("Admin User");
    expect(data[0].email).toBe("admin@example.com");
    expect(data[0].post_count).toBe(5);
    expect(data[0].latest_post_at).toBeDefined();

    // Second author (user) should have 4 posts
    expect(data[1].user_id).toBe(userId);
    expect(data[1].name).toBe("Regular User");
    expect(data[1].email).toBe("user@example.com");
    expect(data[1].post_count).toBe(4);
    expect(data[1].latest_post_at).toBeDefined();
  });

  it("GET /api/analytics/top-authors with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET /api/analytics/top-authors without token returns 401", async () => {
    const res = await fetch(`${BASE}/top-authors`);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

describe("Analytics API - Activity", () => {
  it("GET /api/analytics/activity?days=7 returns array of 7 days with zero-filled dates", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(7);

    // Check that dates are sequential and in ascending order
    for (let i = 0; i < data.length; i++) {
      expect(data[i].date).toBeDefined();
      expect(typeof data[i].new_users).toBe("number");
      expect(typeof data[i].new_posts).toBe("number");
      expect(data[i].new_users).toBeGreaterThanOrEqual(0);
      expect(data[i].new_posts).toBeGreaterThanOrEqual(0);

      if (i > 0) {
        // Dates should be in ascending order
        const prevDate = new Date(data[i - 1].date);
        const currDate = new Date(data[i].date);
        expect(currDate.getTime()).toBeGreaterThan(prevDate.getTime());
      }
    }

    // Check that there are some non-zero entries (we seeded data)
    const hasUserActivity = data.some((d: { new_users: number }) => d.new_users > 0);
    const hasPostActivity = data.some((d: { new_posts: number }) => d.new_posts > 0);
    expect(hasUserActivity).toBe(true);
    expect(hasPostActivity).toBe(true);
  });

  it("GET /api/analytics/activity?days=30 returns array of 30 days", async () => {
    const res = await fetch(`${BASE}/activity?days=30`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(30);
  });

  it("GET /api/analytics/activity with non-admin token returns 403", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET /api/analytics/activity without token returns 401", async () => {
    const res = await fetch(`${BASE}/activity?days=7`);

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("GET /api/analytics/activity without days param defaults to 7", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(7);
  });

  it("GET /api/analytics/activity caps days at 365", async () => {
    const res = await fetch(`${BASE}/activity?days=400`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(365);
  });
});
