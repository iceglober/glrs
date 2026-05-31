import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3462;
const BASE = `http://localhost:${PORT}/api`;
let server: Server;

let adminToken: string;
let nonAdminToken: string;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
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

  // Create admin user
  const adminRes = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin", email: "admin@test.com", password: "password123" }),
  });
  const adminData = await adminRes.json();
  adminToken = adminData.token;

  // Update role to admin in DB
  await pool.query("UPDATE users SET role = 'admin' WHERE email = $1", ["admin@test.com"]);

  // Create non-admin user
  const nonAdminRes = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "User", email: "user@test.com", password: "password123" }),
  });
  const nonAdminData = await nonAdminRes.json();
  nonAdminToken = nonAdminData.token;
});

describe("Analytics API", () => {
  describe("GET /api/analytics/overview", () => {
    it("admin gets 200 with correct shape", async () => {
      const res = await fetch(`${BASE}/analytics/overview`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty("total_users");
      expect(data).toHaveProperty("total_posts");
      expect(data).toHaveProperty("posts_last_7_days");
      expect(data).toHaveProperty("posts_last_30_days");
      expect(data).toHaveProperty("avg_posts_per_user");
      expect(typeof data.total_users).toBe("number");
      expect(typeof data.total_posts).toBe("number");
      expect(typeof data.posts_last_7_days).toBe("number");
      expect(typeof data.posts_last_30_days).toBe("number");
      expect(typeof data.avg_posts_per_user).toBe("number");
    });

    it("unauthenticated gets 401", async () => {
      const res = await fetch(`${BASE}/analytics/overview`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("non-admin gets 403", async () => {
      const res = await fetch(`${BASE}/analytics/overview`, {
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("GET /api/analytics/top-authors", () => {
    it("admin gets 200 with array sorted by post_count DESC", async () => {
      // Create some posts for the admin user
      await pool.query("INSERT INTO posts (user_id, title, body) VALUES ($1, $2, $3)", [
        (await pool.query("SELECT id FROM users WHERE email = $1", ["admin@test.com"])).rows[0].id,
        "Post 1",
        "Content 1",
      ]);

      const res = await fetch(`${BASE}/analytics/top-authors`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      // Verify sorted by post_count DESC
      for (let i = 1; i < data.length; i++) {
        expect(data[i].post_count).toBeLessThanOrEqual(data[i - 1].post_count);
      }
    });

    it("?limit=1 returns only 1 result", async () => {
      const res = await fetch(`${BASE}/analytics/top-authors?limit=1`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(1);
    });

    it("non-admin gets 403", async () => {
      const res = await fetch(`${BASE}/analytics/top-authors`, {
        headers: { Authorization: `Bearer ${nonAdminToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("GET /api/analytics/activity", () => {
    it("admin gets 200 with array of daily entries", async () => {
      const res = await fetch(`${BASE}/analytics/activity`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Check shape of entries
      const entry = data[0];
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("new_users");
      expect(entry).toHaveProperty("new_posts");
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.new_users).toBe("number");
      expect(typeof entry.new_posts).toBe("number");
    });

    it("?days=7 returns 7 entries", async () => {
      const res = await fetch(`${BASE}/analytics/activity?days=7`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(7);
    });
  });
});
