import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3463;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let authToken: string;

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
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Seed User", email: "seed@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;
});

async function seedPosts(count: number) {
  // Insert oldest first so the highest id corresponds to the most recent created_at.
  // ORDER BY created_at DESC, id DESC then returns ids in descending order.
  for (let i = count - 1; i >= 0; i--) {
    await pool.query(
      `INSERT INTO posts (title, body, user_id, created_at)
       VALUES ($1, $2, 1, NOW() - ($3 || ' seconds')::interval)`,
      [`Post ${i}`, `Body ${i}`, i * 10],
    );
  }
}

async function seedUsers(count: number) {
  // user id=1 already exists from beforeEach; seed additional users
  for (let i = 2; i <= count; i++) {
    await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x')",
      [`User ${i}`, `user${i}@example.com`],
    );
  }
}

describe("Cursor pagination — posts", () => {
  it("returns paginated envelope with 10 items by default", async () => {
    await seedPosts(12);

    const res = await fetch(POSTS_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(10);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");
    expect(body.next_cursor).not.toBeNull();

    // verify descending order by id (each post has distinct timestamp so id order = created_at order)
    const ids: number[] = body.data.map((p: { id: number }) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("follows next_cursor to get subsequent pages and ends cleanly", async () => {
    await seedPosts(12);

    const firstRes = await fetch(POSTS_BASE);
    const firstPage = await firstRes.json();
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.data).toHaveLength(10);

    const secondRes = await fetch(`${POSTS_BASE}?cursor=${firstPage.next_cursor}`);
    expect(secondRes.status).toBe(200);
    const secondPage = await secondRes.json();
    expect(secondPage.data).toHaveLength(2);
    expect(secondPage.has_more).toBe(false);
    expect(secondPage.next_cursor).toBeNull();

    const allIds = [
      ...firstPage.data.map((p: { id: number }) => p.id),
      ...secondPage.data.map((p: { id: number }) => p.id),
    ];
    expect(new Set(allIds).size).toBe(12);
  });

  it("honors ?limit=5", async () => {
    await seedPosts(8);

    const res = await fetch(`${POSTS_BASE}?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(5);
    expect(body.has_more).toBe(true);
  });

  it("clamps ?limit=500 to 100 and returns all rows when total < 100", async () => {
    await seedPosts(12);

    const res = await fetch(`${POSTS_BASE}?limit=500`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(12);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
  });

  it("returns 400 for an invalid cursor", async () => {
    const res = await fetch(`${POSTS_BASE}?cursor=notvalidbase64!!!`);
    expect(res.status).toBe(400);
  });
});

describe("Cursor pagination — users", () => {
  it("paginates users by id desc with correct envelope", async () => {
    await seedUsers(12); // 1 from beforeEach + 11 seeded = 12 total

    const res = await fetch(USERS_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(10);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");

    const ids: number[] = body.data.map((u: { id: number }) => u.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("follows next_cursor through all users and ends cleanly", async () => {
    await seedUsers(12);

    const firstRes = await fetch(USERS_BASE);
    const firstPage = await firstRes.json();
    expect(firstPage.has_more).toBe(true);

    const secondRes = await fetch(`${USERS_BASE}?cursor=${firstPage.next_cursor}`);
    expect(secondRes.status).toBe(200);
    const secondPage = await secondRes.json();
    expect(secondPage.data).toHaveLength(2);
    expect(secondPage.has_more).toBe(false);
    expect(secondPage.next_cursor).toBeNull();
  });

  it("honors ?limit=5 for users", async () => {
    await seedUsers(12);

    const res = await fetch(`${USERS_BASE}?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(5);
    expect(body.has_more).toBe(true);
  });

  it("returns 400 for an invalid cursor", async () => {
    const res = await fetch(`${USERS_BASE}?cursor=!!!invalid!!!`);
    expect(res.status).toBe(400);
  });
});
