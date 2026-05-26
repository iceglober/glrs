import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import express from "express";
import type { Server } from "http";
import tagsRouter, { postTagsRouter } from "../src/routes/tags.js";
import { authRouter } from "../src/routes/auth.js";

const PORT = 3461;
const BASE_URL = `http://localhost:${PORT}`;

let server: Server;
let authToken: string;
let userId: number;
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
  app.use("/api/tags", tagsRouter);
  app.use("/api/posts/:postId/tags", postTagsRouter);

  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE tags RESTART IDENTITY CASCADE");

  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;
  userId = data.user.id;

  const { rows } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING *",
    ["Test Post", "Test Body", userId],
  );
  postId = rows[0].id;
});

describe("Tags API", () => {
  it("POST /api/tags creates a tag and returns 201 with tag object", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    expect(res.status).toBe(201);
    const tag = await res.json();
    expect(tag.name).toBe("javascript");
    expect(tag.id).toBeDefined();
    expect(tag.created_at).toBeDefined();
  });

  it("POST /api/tags with duplicate name returns 409", async () => {
    await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /api/tags returns all tags each with post_count field", async () => {
    await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const res = await fetch(`${BASE_URL}/api/tags`);
    expect(res.status).toBe(200);
    const tags = await res.json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("javascript");
    expect(tags[0].post_count).toBeDefined();
    expect(Number(tags[0].post_count)).toBe(0);
  });

  it("GET /api/tags post_count reflects number of associated posts", async () => {
    const tagRes = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const tag = await tagRes.json();

    await fetch(`${BASE_URL}/api/posts/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });

    const res = await fetch(`${BASE_URL}/api/tags`);
    const tags = await res.json();
    expect(Number(tags[0].post_count)).toBe(1);
  });

  it("POST /api/posts/:postId/tags creates a post-tag association and returns 201", async () => {
    const tagRes = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const tag = await tagRes.json();

    const res = await fetch(`${BASE_URL}/api/posts/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });
    expect(res.status).toBe(201);
  });

  it("GET /api/posts/:postId/tags returns all tags for the given post", async () => {
    const tagRes = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const tag = await tagRes.json();

    await fetch(`${BASE_URL}/api/posts/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });

    const res = await fetch(`${BASE_URL}/api/posts/${postId}/tags`);
    expect(res.status).toBe(200);
    const tags = await res.json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("javascript");
  });

  it("DELETE /api/posts/:postId/tags/:tagId removes the association and returns 204", async () => {
    const tagRes = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });
    const tag = await tagRes.json();

    await fetch(`${BASE_URL}/api/posts/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });

    const delRes = await fetch(`${BASE_URL}/api/posts/${postId}/tags/${tag.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE_URL}/api/posts/${postId}/tags`);
    const tags = await getRes.json();
    expect(tags).toHaveLength(0);
  });

  it("POST /api/tags without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "javascript" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/posts/:postId/tags without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/posts/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("DELETE /api/posts/:postId/tags/:tagId without auth returns 401", async () => {
    const res = await fetch(`${BASE_URL}/api/posts/${postId}/tags/1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
