import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3464;
const BASE = `http://localhost:${PORT}/api/analytics`;

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

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  const { rows: [admin] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Admin', 'admin@test.com', 'admin') RETURNING id",
  );
  adminToken = generateToken(admin.id);

  const { rows: [alice] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Alice', 'alice@test.com', 'user') RETURNING id",
  );
  const { rows: [bob] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Bob', 'bob@test.com', 'user') RETURNING id",
  );
  userToken = generateToken(alice.id);

  // Alice: 3 posts — 2 within last 7 days, all 3 within last 30 days
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW())",
    ["Alice Post 1", "Content 1", alice.id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '2 days')",
    ["Alice Post 2", "Content 2", alice.id],
  );
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '15 days')",
    ["Alice Post 3", "Content 3", alice.id],
  );
  // Bob: 1 post within 30 days but not 7
  await pool.query(
    "INSERT INTO posts (title, body, user_id, created_at) VALUES ($1, $2, $3, NOW() - INTERVAL '10 days')",
    ["Bob Post 1", "Content 4", bob.id],
  );
});

describe("GET /api/analytics/overview", () => {
  it("returns correct totals as admin", async () => {
    const res = await fetch(`${BASE}/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_users).toBe(3);
    expect(body.total_posts).toBe(4);
    expect(body.posts_last_7_days).toBe(2);
    expect(body.posts_last_30_days).toBe(4);
    expect(typeof body.avg_posts_per_user).toBe("number");
  });

  it("returns 401 for unauthenticated request", async () => {
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
  it("returns top authors sorted by post_count DESC with limit=2", async () => {
    const res = await fetch(`${BASE}/top-authors?limit=2`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe("Alice");
    expect(body[0].post_count).toBe(3);
    expect(body[1].name).toBe("Bob");
    expect(body[1].post_count).toBe(1);
    expect(body[0]).toHaveProperty("user_id");
    expect(body[0]).toHaveProperty("email");
    expect(body[0]).toHaveProperty("latest_post_at");
  });

  it("defaults to limit 10 and returns all users", async () => {
    const res = await fetch(`${BASE}/top-authors`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(3);
  });

  it("returns 401 for unauthenticated request", async () => {
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
  it("returns 7 entries for days=7 including zero-activity days", async () => {
    const res = await fetch(`${BASE}/activity?days=7`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(7);
    expect(body[0]).toHaveProperty("date");
    expect(body[0]).toHaveProperty("new_users");
    expect(body[0]).toHaveProperty("new_posts");
    // 2 posts fall within last 7 days (Alice post 1: today, Alice post 2: 2 days ago)
    const totalNewPosts = body.reduce(
      (sum: number, row: { new_posts: number }) => sum + Number(row.new_posts),
      0,
    );
    expect(totalNewPosts).toBe(2);
  });

  it("defaults to 30 days", async () => {
    const res = await fetch(`${BASE}/activity`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(30);
  });

  it("returns 401 for unauthenticated request", async () => {
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
