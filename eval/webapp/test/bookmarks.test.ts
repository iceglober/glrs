import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import express from "express";
import type { Server } from "http";
import bookmarksRouter from "../src/routes/bookmarks.js";
import { authRouter } from "../src/routes/auth.js";

const PORT = 3466;
const BASE_URL = `http://localhost:${PORT}`;

let server: Server;
let authToken: string;
let authUserId: number;
let authToken2: string;
let postId: number;

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

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/bookmarks", bookmarksRouter);

  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  const res1 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data1 = await res1.json();
  authToken = data1.token;
  authUserId = data1.user.id;

  const res2 = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const data2 = await res2.json();
  authToken2 = data2.token;

  const { rows } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING *",
    ["Test Post", "Test Body", authUserId],
  );
  postId = rows[0].id;
});

describe("Bookmarks API", () => {
  it("POST /api/bookmarks with valid postId returns 201 and bookmark object", async () => {
    const res = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });
    expect(res.status).toBe(201);
    const bookmark = await res.json();
    expect(bookmark.id).toBeDefined();
    expect(bookmark.user_id).toBe(authUserId);
    expect(bookmark.post_id).toBe(postId);
    expect(bookmark.created_at).toBeDefined();
  });

  it("GET /api/bookmarks returns bookmarks with post title and author name, ordered by created_at DESC", async () => {
    await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });

    const res = await fetch(`${BASE_URL}/api/bookmarks`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status).toBe(200);
    const bookmarks = await res.json();
    expect(Array.isArray(bookmarks)).toBe(true);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].post_title).toBe("Test Post");
    expect(bookmarks[0].author_name).toBe("Alice");
  });

  it("DELETE /api/bookmarks/:id by owner returns 204 and bookmark is gone", async () => {
    const createRes = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });
    const bookmark = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE_URL}/api/bookmarks`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const bookmarks = await getRes.json();
    expect(bookmarks).toHaveLength(0);
  });

  it("POST /api/bookmarks with duplicate user_id+post_id returns 409", async () => {
    await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });

    const res = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });
    expect(res.status).toBe(409);
  });

  it("POST /api/bookmarks with nonexistent postId returns 404", async () => {
    const res = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId: 99999 }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/bookmarks without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("GET /api/bookmarks without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/bookmarks`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("DELETE /api/bookmarks/:id without auth returns 401", async () => {
    const createRes = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });
    const bookmark = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(401);
    const data = await delRes.json();
    expect(data.error).toBe("Authentication required");
  });

  it("DELETE /api/bookmarks/:id by non-owner returns 403", async () => {
    const createRes = await fetch(`${BASE_URL}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ postId }),
    });
    const bookmark = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/bookmarks/${bookmark.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken2}` },
    });
    expect(delRes.status).toBe(403);
  });
});
