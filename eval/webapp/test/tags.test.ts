import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import express from "express";
import { pool } from "../src/db.js";
import { postsRouter } from "../src/routes/posts.js";
import { authRouter } from "../src/routes/auth.js";
import tagsRouter from "../src/routes/tags.js";
import type { Server } from "http";

const PORT = 3465;
const TAGS_BASE = `http://localhost:${PORT}/api/tags`;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

const testApp = express();
testApp.use(express.json());
testApp.use("/api/auth", authRouter);
testApp.use("/api/posts", postsRouter);
testApp.use("/api", tagsRouter);

let server: Server;
let authToken: string;
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
  await pool.query("TRUNCATE tags RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");

  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;

  const postRes = await fetch(POSTS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ title: "Test Post", body: "Test Body" }),
  });
  const post = await postRes.json();
  postId = post.id;
});

describe("Tags API", () => {
  it("POST /api/tags with valid auth creates a tag and returns 201", async () => {
    const res = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "typescript" }),
    });
    expect(res.status).toBe(201);
    const tag = await res.json();
    expect(tag.id).toBeDefined();
    expect(tag.name).toBe("typescript");
    expect(tag.created_at).toBeDefined();
  });

  it("POST /api/tags with duplicate name returns 409", async () => {
    await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "typescript" }),
    });
    const res = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "typescript" }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /api/tags returns all tags with post_count", async () => {
    await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "javascript" }),
    });

    const res = await fetch(TAGS_BASE);
    expect(res.status).toBe(200);
    const tags = await res.json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("javascript");
    expect(tags[0].post_count).toBeDefined();
    expect(typeof tags[0].post_count).toBe("number");
  });

  it("POST /api/posts/:postId/tags creates association and returns 201", async () => {
    const tagRes = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "node" }),
    });
    const tag = await tagRes.json();

    const res = await fetch(`${POSTS_BASE}/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });
    expect(res.status).toBe(201);
  });

  it("GET /api/posts/:postId/tags returns tags for the post", async () => {
    const tagRes = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "express" }),
    });
    const tag = await tagRes.json();

    await fetch(`${POSTS_BASE}/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });

    const res = await fetch(`${POSTS_BASE}/${postId}/tags`);
    expect(res.status).toBe(200);
    const tags = await res.json();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe("express");
  });

  it("DELETE /api/posts/:postId/tags/:tagId removes association and returns 204", async () => {
    const tagRes = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "postgres" }),
    });
    const tag = await tagRes.json();

    await fetch(`${POSTS_BASE}/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ tagId: tag.id }),
    });

    const delRes = await fetch(`${POSTS_BASE}/${postId}/tags/${tag.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const listRes = await fetch(`${POSTS_BASE}/${postId}/tags`);
    const remaining = await listRes.json();
    expect(remaining).toHaveLength(0);
  });

  it("POST /api/tags without auth returns 401", async () => {
    const res = await fetch(TAGS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "noauth" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/posts/:postId/tags without auth returns 401", async () => {
    const res = await fetch(`${POSTS_BASE}/${postId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
