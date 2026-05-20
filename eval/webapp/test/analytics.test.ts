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

  // Register a regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Regular", email: "regular@example.com", password: "password123" }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
});

describe("GET /api/analytics/overview", () => {
  it("returns aggregate stats matching seeded data", async () => {
    // Create some posts for the admin user (user_id 1)
    const adminUserId = (await pool.query("SELECT id FROM users WHERE email = 'admin@example.com'")).rows[0].id;
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["Post 1", "Body 1", adminUserId],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["Post 2", "Body 2", adminUserId],
    );

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

    expect(data.total_users).toBe(2); // admin + regular
    expect(data.total_posts).toBe(2);
    expect(data.posts_last_7_days).toBe(2);
    expect(data.posts_last_30_days).toBe(2);
    expect(data.avg_posts_per_user).toBe(1); // 2 posts / 2 users
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns array sorted by post_count DESC with expected fields", async () => {
    const adminUserId = (await pool.query("SELECT id FROM users WHERE email = 'admin@example.com'")).rows[0].id;
    const regularUserId = (await pool.query("SELECT id FROM users WHERE email = 'regular@example.com'")).rows[0].id;

    // Admin gets 3 posts, regular gets 1
    for (let i = 0; i < 3; i++) {
      await pool.query(
        "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
        [`Admin Post ${i}`, `Body ${i}`, adminUserId],
      );
    }
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["Regular Post", "Body", regularUserId],
    );

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);

    // First author should have highest post_count
    expect(data[0].post_count).toBeGreaterThanOrEqual(data[1].post_count);
    expect(data[0].post_count).toBe(3);
    expect(data[1].post_count).toBe(1);

    // Check fields
    for (const author of data) {
      expect(typeof author.user_id).toBe("number");
      expect(typeof author.name).toBe("string");
      expect(typeof author.email).toBe("string");
      expect(typeof author.post_count).toBe("number");
      expect(author.latest_post_at).toBeDefined();
    }
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns array of 7 objects with date, new_users, new_posts (zero-filled)", async () => {
    const adminUserId = (await pool.query("SELECT id FROM users WHERE email = 'admin@example.com'")).rows[0].id;
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["Today Post", "Body", adminUserId],
    );

    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(7);

    // Each object has date, new_users, new_posts
    for (const entry of data) {
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    }

    // Today should have the seeded data (2 users registered today, 1 post)
    const today = new Date().toISOString().split("T")[0];
    const todayEntry = data.find((d: any) => d.date === today);
    expect(todayEntry).toBeDefined();
    expect(todayEntry!.new_users).toBe(2); // admin + regular registered today
    expect(todayEntry!.new_posts).toBe(1);

    // Zero-filled: at least some days should have 0
    const zeroDays = data.filter((d: any) => d.new_users === 0 && d.new_posts === 0);
    expect(zeroDays.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Authorization checks", () => {
  it("non-admin token gets 403 on /overview", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("non-admin token gets 403 on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("non-admin token gets 403 on /activity", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("missing token gets 401 on /overview", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("missing token gets 401 on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("missing token gets 401 on /activity", async () => {
    const res = await fetch(`${BASE}/activity?days=7`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });
});
