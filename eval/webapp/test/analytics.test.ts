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

async function registerAndGetToken(name: string, email: string): Promise<{ token: string; userId: number }> {
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "password123" }),
  });
  const data = await res.json();
  return { token: data.token, userId: data.user.id };
}

beforeAll(async () => {
  // Run migrations
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f: string) => f.endsWith(".sql"))
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
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  // Create admin user
  const admin = await registerAndGetToken("Admin", "admin@example.com");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.userId]);
  // Re-login to get token with updated role (requireAuth reads role from DB so existing token works)
  adminToken = admin.token;

  // Create regular user
  const user = await registerAndGetToken("Regular", "regular@example.com");
  userToken = user.token;
});

describe("GET /api/analytics/overview", () => {
  it("returns overview stats matching seeded data", async () => {
    // Create some posts for admin user (id=1)
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW())",
      ["Post 1", "Body 1", 1],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW())",
      ["Post 2", "Body 2", 1],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '20 days')",
      ["Post 3", "Body 3", 2],
    );
    // One post older than 30 days
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '60 days')",
      ["Old Post", "Old Body", 2],
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

    expect(data.total_users).toBe(2);
    expect(data.total_posts).toBe(4);
    expect(data.posts_last_7_days).toBe(2);
    expect(data.posts_last_30_days).toBe(3);
    expect(data.avg_posts_per_user).toBe(2); // 4 posts / 2 users
  });

  it("returns 403 for non-admin", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Forbidden");
  });

  it("returns 401 without token", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns authors sorted by post_count DESC with correct fields", async () => {
    // Admin (id=1) gets 3 posts, Regular (id=2) gets 1 post
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["A1", "Body", 1],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["A2", "Body", 1],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["A3", "Body", 1],
    );
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["R1", "Body", 2],
    );

    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);

    // First author should have more posts
    expect(data[0].post_count).toBeGreaterThanOrEqual(data[1].post_count);

    // Verify fields
    for (const author of data) {
      expect(typeof author.user_id).toBe("number");
      expect(typeof author.name).toBe("string");
      expect(typeof author.email).toBe("string");
      expect(typeof author.post_count).toBe("number");
      expect(author.latest_post_at).toBeDefined();
    }

    // First is admin with 3 posts
    expect(data[0].user_id).toBe(1);
    expect(data[0].name).toBe("Admin");
    expect(data[0].email).toBe("admin@example.com");
    expect(data[0].post_count).toBe(3);

    // Second is regular with 1 post
    expect(data[1].user_id).toBe(2);
    expect(data[1].post_count).toBe(1);
  });

  it("returns 403 for non-admin", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns array of 7 objects with zero-filled days when days=7", async () => {
    // Create one post today
    await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3)",
      ["Today", "Body", 1],
    );

    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(7);

    // Each entry should have date, new_users, new_posts
    for (const entry of data) {
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    }

    // Last entry (today) should have new_users >= 2 (admin + regular registered today)
    // and new_posts >= 1 (we inserted one)
    const today = data[data.length - 1];
    expect(today.new_users).toBeGreaterThanOrEqual(2);
    expect(today.new_posts).toBeGreaterThanOrEqual(1);

    // Earlier days should have 0 new_posts (unless test timing straddles midnight)
    // Check that at least some days have 0 for new_posts
    const zeroDays = data.filter((d: any) => d.new_posts === 0);
    expect(zeroDays.length).toBeGreaterThan(0);
  });

  it("returns 403 for non-admin", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without token", async () => {
    const res = await fetch(`${BASE}/activity?days=7`);
    expect(res.status).toBe(401);
  });
});
