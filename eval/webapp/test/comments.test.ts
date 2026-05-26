import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import express from "express";
import { pool } from "../src/db.js";
import { postsRouter } from "../src/routes/posts.js";
import { authRouter } from "../src/routes/auth.js";
import commentsRouter from "../src/routes/comments.js";
import type { Server } from "http";

const PORT = 3464;
const BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

const testApp = express();
testApp.use(express.json());
testApp.use("/api/auth", authRouter);
testApp.use("/api/posts", postsRouter);
testApp.use("/api/posts", commentsRouter);

let server: Server;
let authToken: string;
let authUserId: number;
let otherToken: string;
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

  server = testApp.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE comments RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  const res1 = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data1 = await res1.json();
  authToken = data1.token;
  authUserId = data1.user.id;

  const res2 = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const data2 = await res2.json();
  otherToken = data2.token;

  const postRes = await fetch(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ title: "Test Post", body: "Test Body" }),
  });
  const post = await postRes.json();
  postId = post.id;
});

describe("Comments API", () => {
  it("POST /api/posts/:postId/comments creates a comment and returns 201", async () => {
    const res = await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Hello comment" }),
    });
    expect(res.status).toBe(201);
    const comment = await res.json();
    expect(comment.id).toBeDefined();
    expect(comment.post_id).toBe(postId);
    expect(comment.user_id).toBe(authUserId);
    expect(comment.body).toBe("Hello comment");
    expect(comment.created_at).toBeDefined();
  });

  it("GET /api/posts/:postId/comments returns comments with author name", async () => {
    await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "A comment" }),
    });

    const res = await fetch(`${BASE}/${postId}/comments`);
    expect(res.status).toBe(200);
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("A comment");
    expect(comments[0].author_name).toBeDefined();
    expect(comments[0].author_name).toBe("Alice");
  });

  it("DELETE /api/posts/:postId/comments/:id by author returns 204 and comment is gone", async () => {
    const createRes = await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "To be deleted" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE}/${postId}/comments/${comment.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const listRes = await fetch(`${BASE}/${postId}/comments`);
    const remaining = await listRes.json();
    expect(remaining).toHaveLength(0);
  });

  it("DELETE by different non-admin user returns 403", async () => {
    const createRes = await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Alice's comment" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE}/${postId}/comments/${comment.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(delRes.status).toBe(403);
  });

  it("POST without auth returns 401", async () => {
    const res = await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "No auth" }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE without auth returns 401", async () => {
    const createRes = await fetch(`${BASE}/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Some comment" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE}/${postId}/comments/${comment.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(401);
  });
});
