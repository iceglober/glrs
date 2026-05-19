import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3462;
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  // Register admin, then escalate role in DB, use generateToken directly
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@example.com", password: "adminpass1" }),
  });
  const adminData = await adminRes.json() as { user: { id: number }; token: string };
  const adminId = adminData.user.id;
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  adminToken = generateToken(adminId);

  // Register two regular users
  const user1Res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const user1Data = await user1Res.json() as { user: { id: number }; token: string };
  userToken = user1Data.token;
  const user1Id = user1Data.user.id;

  const user2Res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const user2Data = await user2Res.json() as { user: { id: number }; token: string };
  const user2Id = user2Data.user.id;

  // Insert 5 posts with varying timestamps: 3 within 7 days, 4 within 30 days, 5 total
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1,$2,$3, NOW())",
    ["Post today", "Body", user1Id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1,$2,$3, NOW() - INTERVAL '1 day')",
    ["Post 1d ago", "Body", user1Id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1,$2,$3, NOW() - INTERVAL '3 days')",
    ["Post 3d ago", "Body", user1Id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1,$2,$3, NOW() - INTERVAL '10 days')",
    ["Post 10d ago", "Body", user2Id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1,$2,$3, NOW() - INTERVAL '40 days')",
    ["Post 40d ago", "Body", user2Id],
  );
});

describe("GET /api/analytics/overview", () => {
  it("returns 200 with all five numeric fields for admin", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.total_users).toBe("number");
    expect(typeof body.total_posts).toBe("number");
    expect(typeof body.posts_last_7_days).toBe("number");
    expect(typeof body.posts_last_30_days).toBe("number");
    expect(typeof body.avg_posts_per_user).toBe("number");
    expect(body.total_users).toBe(3);
    expect(body.total_posts).toBe(5);
    expect(body.posts_last_7_days).toBe(3);
    expect(body.posts_last_30_days).toBe(4);
    expect((body.avg_posts_per_user as number)).toBeCloseTo(5 / 3, 5);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await fetch(`${BASE}/overview`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/analytics/top-authors", () => {
  it("returns array sorted by post_count DESC with correct shape", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(typeof body[0].user_id).toBe("number");
    expect(typeof body[0].name).toBe("string");
    expect(typeof body[0].email).toBe("string");
    expect(typeof body[0].post_count).toBe("number");
    // Sorted by post_count DESC
    for (let i = 1; i < body.length; i++) {
      expect(body[i - 1].post_count as number).toBeGreaterThanOrEqual(body[i].post_count as number);
    }
    // Alice has 3 posts, Bob has 2
    expect(body[0].post_count).toBe(3);
  });

  it("respects the limit parameter", async () => {
    const res = await fetch(`${BASE}/top-authors?limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<unknown>;
    expect(body.length).toBeLessThanOrEqual(2);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await fetch(`${BASE}/top-authors`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/analytics/activity", () => {
  it("returns daily breakdown with zero-activity days for days=7", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    // generate_series(CURRENT_DATE - 6, CURRENT_DATE, '1 day') = 7 rows
    expect(body.length).toBe(7);
    // Each row has required fields
    for (const row of body) {
      expect(typeof row.date).toBe("string");
      expect(typeof row.new_users).toBe("number");
      expect(typeof row.new_posts).toBe("number");
    }
    // At least one zero-activity day (not every day has posts in last 7)
    const zeroActivityDays = body.filter((r) => r.new_posts === 0);
    expect(zeroActivityDays.length).toBeGreaterThan(0);
  });

  it("returns 30 rows by default", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Array<unknown>;
    expect(body.length).toBe(30);
  });

  it("returns 401 with no Authorization header", async () => {
    const res = await fetch(`${BASE}/activity`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin user", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });
});
