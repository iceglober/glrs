import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import express from "express";
import type { Server } from "http";
import commentsRouter from "../src/routes/comments.js";
import { authRouter } from "../src/routes/auth.js";

const PORT = 3464;
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
  app.use("/api/posts/:postId/comments", commentsRouter);

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

describe("Comments API", () => {
  it("POST /api/posts/:postId/comments with auth creates a comment and returns 201", async () => {
    const res = await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Great post!" }),
    });
    expect(res.status).toBe(201);
    const comment = await res.json();
    expect(comment.body).toBe("Great post!");
    expect(comment.post_id).toBe(postId);
    expect(comment.user_id).toBe(authUserId);
    expect(comment.author_name).toBe("Alice");
    expect(comment.id).toBeDefined();
  });

  it("GET /api/posts/:postId/comments returns all comments with author names", async () => {
    await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Nice!" }),
    });

    const res = await fetch(`${BASE_URL}/api/posts/${postId}/comments`);
    expect(res.status).toBe(200);
    const comments = await res.json();
    expect(Array.isArray(comments)).toBe(true);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Nice!");
    expect(comments[0].author_name).toBe("Alice");
  });

  it("DELETE /api/posts/:postId/comments/:id by comment author returns 204 and comment is gone", async () => {
    const createRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "To be deleted" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments/${comment.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments`);
    const comments = await getRes.json();
    expect(comments).toHaveLength(0);
  });

  it("DELETE by a different non-admin user returns 403", async () => {
    const createRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Alice's comment" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments/${comment.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken2}` },
    });
    expect(delRes.status).toBe(403);
  });

  it("POST without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "No auth" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("DELETE without auth returns 401", async () => {
    const createRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "Some comment" }),
    });
    const comment = await createRes.json();

    const delRes = await fetch(`${BASE_URL}/api/posts/${postId}/comments/${comment.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(401);
    const data = await delRes.json();
    expect(data.error).toBe("Authentication required");
  });
});
