import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3458;
const BASE = `http://localhost:${PORT}/api/posts`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;

let server: Server;
let userId: number;

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
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  const res = await fetch(USERS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com" }),
  });
  const user = await res.json();
  userId = user.id;
});

describe("Posts API", () => {
  it("POST /api/posts creates a post and returns 201", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World", user_id: userId }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.title).toBe("Hello");
    expect(post.body).toBe("World");
    expect(post.user_id).toBe(userId);
    expect(post.id).toBeDefined();
  });

  it("POST /api/posts without required fields returns 400", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/posts with non-existent user_id returns 400", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World", user_id: 99999 }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/posts returns posts ordered by created_at DESC", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "First", body: "Body 1", user_id: userId }),
    });
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Second", body: "Body 2", user_id: userId }),
    });
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const posts = await res.json();
    expect(posts).toHaveLength(2);
    expect(posts[0].title).toBe("Second");
    expect(posts[1].title).toBe("First");
  });

  it("GET /api/posts/:id returns a specific post", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World", user_id: userId }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    const post = await res.json();
    expect(post.title).toBe("Hello");
    expect(post.id).toBe(created.id);
  });

  it("GET /api/posts/999 returns 404", async () => {
    const res = await fetch(`${BASE}/999`);
    expect(res.status).toBe(404);
  });

  it("PUT /api/posts/:id updates title and/or body", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Original", body: "Content", user_id: userId }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("Updated");
    expect(updated.body).toBe("Content");
  });

  it("DELETE /api/posts/:id returns 204 and post is gone", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Delete me", body: "Content", user_id: userId }),
    });
    const created = await createRes.json();

    const delRes = await fetch(`${BASE}/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE}/${created.id}`);
    expect(getRes.status).toBe(404);
  });
});
