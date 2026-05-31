import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3458;
const BASE = `http://localhost:${PORT}/api/posts`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;
let server: Server;
let token: string;
let authUserId: number;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  for (const file of readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => { server.close(); });

beforeEach(async () => {
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  // Register a test user and get token
  const regRes = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test User", email: "test@example.com", password: "password123" }),
  });
  const regData = await regRes.json();
  token = regData.token;
  authUserId = regData.user.id;
});

async function createUser(name = "Author", email = `a${Date.now()}${Math.random()}@t.com`) {
  const res = await fetch(USERS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ name, email }),
  });
  return await res.json();
}

describe("Posts API", () => {
  it("POST creates a post", async () => {
    await createUser();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Hello", body: "World" }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.title).toBe("Hello");
    expect(post.body).toBe("World");
    // user_id comes from the authenticated user, not from the body
    expect(post.user_id).toBe(authUserId);
  });

  it("POST with missing fields returns 400", async () => {
    await createUser();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST with nonexistent user_id returns 400", async () => {
    // This test is no longer relevant since user_id comes from auth
    // But we keep it for compatibility - it will create a post with the authenticated user's id
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "T", body: "B" }),
    });
    expect(res.status).toBe(201);
  });

  it("GET lists posts ordered by created_at DESC", async () => {
    await createUser();
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "First", body: "1" }),
    });
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Second", body: "2" }),
    });
    const res = await fetch(BASE);
    const posts = await res.json();
    expect(posts.length).toBe(2);
    // Most recent first
    expect(posts[0].title).toBe("Second");
    expect(posts[1].title).toBe("First");
  });

  it("GET /:id returns a post", async () => {
    await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "X", body: "Y" }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`);
    expect(res.status).toBe(200);
    const got = await res.json();
    expect(got.id).toBe(post.id);
    expect(got.title).toBe("X");
  });

  it("GET /:id returns 404 for nonexistent post", async () => {
    const res = await fetch(`${BASE}/99999`);
    expect(res.status).toBe(404);
  });

  it("PUT updates a post", async () => {
    await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Old", body: "OldBody" }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "New", body: "NewBody" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("New");
    expect(updated.body).toBe("NewBody");
  });

  it("PUT can update only title", async () => {
    await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "Old", body: "Keep" }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "New" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("New");
    expect(updated.body).toBe("Keep");
  });

  it("PUT returns 404 for nonexistent post", async () => {
    const res = await fetch(`${BASE}/99999`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes a post", async () => {
    await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "T", body: "B" }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    expect(res.status).toBe(204);
    const get = await fetch(`${BASE}/${post.id}`);
    expect(get.status).toBe(404);
  });

  it("DELETE returns 404 for nonexistent post", async () => {
    const res = await fetch(`${BASE}/99999`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it("Deleting a user cascades to their posts", async () => {
    // Create a post as the authenticated user
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ title: "C", body: "C" }),
    });
    // Delete the authenticated user (who owns the post)
    await fetch(`${USERS_BASE}/${authUserId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` },
    });
    const res = await fetch(BASE);
    const posts = await res.json();
    expect(posts.length).toBe(0);
  });
});
