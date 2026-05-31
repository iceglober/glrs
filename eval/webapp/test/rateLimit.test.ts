import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

// Set env vars BEFORE any imports that read them
process.env.RATE_LIMIT_READ_MAX = "3";
process.env.RATE_LIMIT_WRITE_MAX = "2";
process.env.RATE_LIMIT_WINDOW_SECONDS = "60";

// Now import modules that read env vars
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { rateLimitConfig } from "../src/middleware/rateLimit.js";
import type { Server } from "http";

const PORT = 3463;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
let server: Server;
let token: string;
let adminToken: string;
let userId: number;
let adminId: number;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  for (const file of readdirSync(migrationsDir).filter((f: string) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
  // Restore env vars so subsequent test files use production defaults
  delete process.env.RATE_LIMIT_READ_MAX;
  delete process.env.RATE_LIMIT_WRITE_MAX;
  delete process.env.RATE_LIMIT_WINDOW_SECONDS;
});

beforeEach(async () => {
  await pool.query("TRUNCATE rate_limit_requests RESTART IDENTITY");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  // Register normal user
  const regRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: "password123" }),
  });
  const regData = await regRes.json() as { token: string; user: { id: number } };
  token = regData.token;
  userId = regData.user.id;

  // Register admin user via register endpoint, then promote
  const adminRegRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin User", email: "admin@example.com", password: "adminpass123" }),
  });
  const adminRegData = await adminRegRes.json() as { token: string; user: { id: number } };
  adminId = adminRegData.user.id;
  // Promote to admin
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [adminId]);
  // Clear rate limit slots consumed by setup POSTs before logging in
  await pool.query("TRUNCATE rate_limit_requests RESTART IDENTITY");
  // Login to get fresh token with admin role
  const loginRes = await fetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "adminpass123" }),
  });
  const loginData = await loginRes.json() as { token: string };
  adminToken = loginData.token;

  // Clear rate_limit_requests after setup so tests start with a clean slate
  await pool.query("TRUNCATE rate_limit_requests RESTART IDENTITY");
});

describe("Rate Limiting", () => {
  it("migration creates rate_limit_requests table with required columns", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'rate_limit_requests'`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("key");
    expect(columns).toContain("category");
    expect(columns).toContain("created_at");
  });

  it("rateLimitConfig exposes overridable readMax/writeMax/windowSeconds", () => {
    expect(rateLimitConfig.readMax).toBe(3);
    expect(rateLimitConfig.writeMax).toBe(2);
    expect(rateLimitConfig.windowSeconds).toBe(60);
  });

  it("authenticated user gets 429 after exceeding read quota", async () => {
    // 3 GETs should succeed
    for (let i = 0; i < 3; i++) {
      const res = await fetch(POSTS_BASE, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).not.toBe(429);
    }
    // 4th GET should be 429
    const res = await fetch(POSTS_BASE, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
  });

  it("429 response includes Retry-After header in seconds", async () => {
    // Exhaust quota
    for (let i = 0; i < 3; i++) {
      await fetch(POSTS_BASE, { headers: { Authorization: `Bearer ${token}` } });
    }
    const res = await fetch(POSTS_BASE, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  });

  it("429 response body has error and retryAfter fields", async () => {
    // Exhaust quota
    for (let i = 0; i < 3; i++) {
      await fetch(POSTS_BASE, { headers: { Authorization: `Bearer ${token}` } });
    }
    const res = await fetch(POSTS_BASE, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; retryAfter: number };
    expect(body.error).toBe("Rate limit exceeded");
    expect(typeof body.retryAfter).toBe("number");
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("read and write quotas are tracked independently", async () => {
    // Exhaust read quota (3 GETs)
    for (let i = 0; i < 3; i++) {
      await fetch(POSTS_BASE, { headers: { Authorization: `Bearer ${token}` } });
    }
    // 4th GET should be 429
    const readRes = await fetch(POSTS_BASE, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(readRes.status).toBe(429);

    // First POST (write) should NOT be 429 — write quota is 2, none used yet
    const writeRes = await fetch(POSTS_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Test", body: "Content" }),
    });
    expect(writeRes.status).not.toBe(429);
  });

  it("admin user bypasses rate limit entirely", async () => {
    // Make 10 GETs as admin — none should be 429
    for (let i = 0; i < 10; i++) {
      const res = await fetch(POSTS_BASE, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).not.toBe(429);
    }
  });

  it("admin requests do not insert rate_limit_requests rows", async () => {
    // Make 10 GETs as admin
    for (let i = 0; i < 10; i++) {
      await fetch(POSTS_BASE, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }
    // No rows should exist for admin's key
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM rate_limit_requests WHERE key = $1",
      [`user:${adminId}`],
    );
    expect(Number(rows[0].count)).toBe(0);
  });

  it("unauthenticated requests are rate-limited by IP", async () => {
    // 3 unauthenticated GETs should succeed
    for (let i = 0; i < 3; i++) {
      const res = await fetch(POSTS_BASE);
      expect(res.status).not.toBe(429);
    }
    // 4th should be 429
    const res = await fetch(POSTS_BASE);
    expect(res.status).toBe(429);

    // Verify a row exists with key LIKE 'ip:%'
    const { rows } = await pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM rate_limit_requests WHERE key LIKE 'ip:%'",
    );
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });
});
