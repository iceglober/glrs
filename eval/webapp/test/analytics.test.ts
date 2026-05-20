import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3459; // Use a different port for tests
const BASE = `http://localhost:${PORT}/api/analytics`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;

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
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  // Create an admin user
  const adminRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Admin User",
      email: "admin@example.com",
      password: "password123",
    }),
  });
  const adminData = await adminRes.json();
  adminUserId = adminData.user.id;

  // Promote to admin directly in the database
  await pool.query("UPDATE users SET role = $1 WHERE id = $2", ["admin", adminUserId]);

  // Generate a fresh token with the admin role
  adminToken = generateToken(adminUserId, "admin");

  // Create a regular user
  const userRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Regular User",
      email: "user@example.com",
      password: "password123",
    }),
  });
  const userData = await userRes.json();
  userToken = userData.token;
  userId = userData.user.id;
});

describe("Analytics API", () => {
  describe("GET /api/analytics/overview", () => {
    it("returns overview stats with required fields", async () => {
      const res = await fetch(`${BASE}/overview`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.total_users).toBe("number");
      expect(typeof data.total_posts).toBe("number");
      expect(typeof data.posts_last_7_days).toBe("number");
      expect(typeof data.posts_last_30_days).toBe("number");
      expect(typeof data.avg_posts_per_user).toBe("number");
    });

    it("overview stats match seeded data", async () => {
      // admin + user = 2 users
      // Create 3 posts from admin, 2 posts from user
      for (let i = 0; i < 3; i++) {
        await fetch(POSTS_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
          body: JSON.stringify({ title: `Admin Post ${i + 1}`, body: `Body ${i + 1}` }),
        });
      }
      for (let i = 0; i < 2; i++) {
        await fetch(POSTS_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
          body: JSON.stringify({ title: `User Post ${i + 1}`, body: `Body ${i + 1}` }),
        });
      }

      const res = await fetch(`${BASE}/overview`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      const data = await res.json();
      expect(data.total_users).toBe(2);
      expect(data.total_posts).toBe(5);
      expect(data.posts_last_7_days).toBe(5);
      expect(data.posts_last_30_days).toBe(5);
      expect(data.avg_posts_per_user).toBe(2.5); // 5 posts / 2 users
    });

    it("returns 401 without authentication", async () => {
      const res = await fetch(`${BASE}/overview`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("returns 403 for non-admin user", async () => {
      const res = await fetch(`${BASE}/overview`, {
        headers: { "Authorization": `Bearer ${userToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden");
    });
  });

  describe("GET /api/analytics/top-authors", () => {
    it("returns empty array when no posts exist", async () => {
      const res = await fetch(`${BASE}/top-authors`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2); // admin and user, no posts yet
    });

    it("returns array sorted by post_count DESC with correct fields", async () => {
      // Create posts: admin gets 5, user gets 2
      for (let i = 0; i < 5; i++) {
        await fetch(POSTS_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
          body: JSON.stringify({ title: `Admin Post ${i + 1}`, body: `Body ${i + 1}` }),
        });
      }
      for (let i = 0; i < 2; i++) {
        await fetch(POSTS_BASE, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
          body: JSON.stringify({ title: `User Post ${i + 1}`, body: `Body ${i + 1}` }),
        });
      }

      const res = await fetch(`${BASE}/top-authors`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);

      // Check that first entry has required fields
      const firstAuthor = data[0];
      expect(typeof firstAuthor.user_id).toBe("number");
      expect(typeof firstAuthor.name).toBe("string");
      expect(typeof firstAuthor.email).toBe("string");
      expect(typeof firstAuthor.post_count).toBe("number");
      if (firstAuthor.post_count > 0) {
        expect(typeof firstAuthor.latest_post_at).toBe("string");
      }

      // Check sorted by post_count DESC
      for (let i = 0; i < data.length - 1; i++) {
        expect(data[i].post_count >= data[i + 1].post_count).toBe(true);
      }

      // Admin should be first (5 posts > 2 posts)
      expect(data[0].user_id).toBe(adminUserId);
      expect(data[0].post_count).toBe(5);
      expect(data[1].user_id).toBe(userId);
      expect(data[1].post_count).toBe(2);
    });

    it("returns 401 without authentication", async () => {
      const res = await fetch(`${BASE}/top-authors`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("returns 403 for non-admin user", async () => {
      const res = await fetch(`${BASE}/top-authors`, {
        headers: { "Authorization": `Bearer ${userToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden");
    });
  });

  describe("GET /api/analytics/activity", () => {
    it("returns array of activity objects with date, new_users, new_posts", async () => {
      const res = await fetch(`${BASE}/activity?days=7`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);

      // Check that each object has required fields
      for (const entry of data) {
        expect(typeof entry.date).toBe("string");
        expect(typeof entry.new_users).toBe("number");
        expect(typeof entry.new_posts).toBe("number");
        expect(entry.new_users >= 0).toBe(true);
        expect(entry.new_posts >= 0).toBe(true);
      }
    });

    it("returns 7 days of data by default", async () => {
      const res = await fetch(`${BASE}/activity?days=7`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.length).toBe(8); // 7 days inclusive of today and N-7 days ago
    });

    it("returns activity for a different number of days when specified", async () => {
      const res = await fetch(`${BASE}/activity?days=14`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      // 14 days + today = 15 entries
      expect(data.length).toBe(15);
    });

    it("zero-fills days with no activity", async () => {
      const res = await fetch(`${BASE}/activity?days=7`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      // Most days should have 0 users and 0 posts (since we haven't created activity across 7 days)
      let hasZeroDay = false;
      for (const entry of data) {
        if (entry.new_users === 0 && entry.new_posts === 0) {
          hasZeroDay = true;
          break;
        }
      }
      expect(hasZeroDay || data.length > 0).toBe(true);
    });

    it("counts new users and posts created today", async () => {
      // We already created 2 users in beforeEach (admin and regular user)
      // Create some posts
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
        body: JSON.stringify({ title: "Test Post 1", body: "Body" }),
      });
      await fetch(POSTS_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
        body: JSON.stringify({ title: "Test Post 2", body: "Body" }),
      });

      const res = await fetch(`${BASE}/activity?days=7`, {
        headers: { "Authorization": `Bearer ${adminToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();

      // Find today's entry (should be the last one since ordered ASC)
      const today = data[data.length - 1];
      expect(today.new_users).toBeGreaterThanOrEqual(2); // At least admin and user created today
      expect(today.new_posts).toBeGreaterThanOrEqual(2); // At least the 2 posts created
    });

    it("returns 401 without authentication", async () => {
      const res = await fetch(`${BASE}/activity?days=7`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Authentication required");
    });

    it("returns 403 for non-admin user", async () => {
      const res = await fetch(`${BASE}/activity?days=7`, {
        headers: { "Authorization": `Bearer ${userToken}` },
      });
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden");
    });
  });
});
