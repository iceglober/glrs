import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3460;
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let adminToken: string;
let adminId: number;
let userToken: string;
let user2Id: number;
let user3Id: number;

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
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  // Register admin user
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;
  adminId = adminData.user.id;
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);

  // Register two regular users
  const user2Res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const user2Data = await user2Res.json();
  userToken = user2Data.token;
  user2Id = user2Data.user.id;

  const user3Res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Charlie", email: "charlie@example.com", password: "password123" }),
  });
  const user3Data = await user3Res.json();
  user3Id = user3Data.user.id;

  // Insert posts directly with controlled created_at values:
  // admin: 2 recent posts (today) + 1 old post (40 days ago, outside 30d window)
  // user2: 3 recent posts (today) + 2 medium posts (10 days ago, within 30d but outside 7d)
  // user3: 1 recent post (today)
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
  const fortyDaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

  for (let i = 0; i < 2; i++) {
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, $4)",
      [`Admin Post ${i + 1}`, "body", adminId, now],
    );
  }
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, $4)",
    ["Admin Old Post", "body", adminId, fortyDaysAgo],
  );

  for (let i = 0; i < 3; i++) {
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, $4)",
      [`Bob Post ${i + 1}`, "body", user2Id, now],
    );
  }
  for (let i = 0; i < 2; i++) {
    await pool.query(
      "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, $4)",
      [`Bob Medium Post ${i + 1}`, "body", user2Id, tenDaysAgo],
    );
  }

  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, $4)",
    ["Charlie Post 1", "body", user3Id, now],
  );
});

describe("Analytics — overview", () => {
  it("GET /overview returns correct aggregate counts", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_users).toBe(3);
    expect(body.total_posts).toBe(9);
    // 2 + 3 + 1 = 6 posts from today (within 7 days)
    expect(body.posts_last_7_days).toBe(6);
    // 6 today + 2 ten-days-ago = 8 (admin's 40-day-old is outside 30d window)
    expect(body.posts_last_30_days).toBe(8);
    expect(body.avg_posts_per_user).toBe(3);
  });

  it("GET /overview has exactly the expected keys", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(["avg_posts_per_user", "posts_last_30_days", "posts_last_7_days", "total_posts", "total_users"]);
  });
});

describe("Analytics — top-authors", () => {
  it("GET /top-authors returns array sorted by post_count DESC", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
    // Bob has 5 posts — should be first
    expect(body[0].post_count).toBe(5);
    expect(body[0].user_id).toBe(user2Id);
    // Alice has 3 posts — second
    expect(body[1].post_count).toBe(3);
    expect(body[1].user_id).toBe(adminId);
    // Charlie has 1 post — last
    expect(body[2].post_count).toBe(1);
  });

  it("GET /top-authors entries have required fields", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const first = body[0];
    expect(first.user_id).toBeDefined();
    expect(typeof first.name).toBe("string");
    expect(typeof first.email).toBe("string");
    expect(typeof first.post_count).toBe("number");
    expect(first.latest_post_at).toBeDefined();
  });

  it("GET /top-authors?limit=1 returns exactly 1 entry", async () => {
    const res = await fetch(`${BASE}/top-authors?limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].post_count).toBe(5);
  });
});

describe("Analytics — activity", () => {
  it("GET /activity?days=7 returns exactly 7 entries", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(7);
  });

  it("GET /activity?days=7 entries have {date, new_users, new_posts} shape", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    for (const entry of body) {
      expect(entry.date).toBeDefined();
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    }
  });

  it("GET /activity?days=7 includes zero-activity days (proves generate_series)", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    // All posts are from today, so days 1-6 ago have new_posts=0
    const zeroDays = body.filter((e: { new_posts: number }) => e.new_posts === 0);
    expect(zeroDays.length).toBeGreaterThanOrEqual(6);
  });
});

describe("Analytics — access control", () => {
  it("returns 403 for non-admin Bearer token on /overview", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Admin access required");
  });

  it("returns 403 for non-admin Bearer token on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Admin access required");
  });

  it("returns 403 for non-admin Bearer token on /activity", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Admin access required");
  });

  it("returns 401 for missing Authorization header on /overview", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Authentication required");
  });

  it("returns 401 for missing Authorization header on /top-authors", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Authentication required");
  });

  it("returns 401 for missing Authorization header on /activity", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Authentication required");
  });
});
