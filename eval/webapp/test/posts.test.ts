import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3458;
const BASE = `http://localhost:${PORT}/api/posts`;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
let server: Server;

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
});

async function createUser(name = "Author", email = `a${Date.now()}${Math.random()}@t.com`) {
  const res = await fetch(USERS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email }),
  });
  return await res.json();
}

describe("Posts API", () => {
  it("POST creates a post", async () => {
    const user = await createUser();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World", user_id: user.id }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.title).toBe("Hello");
    expect(post.body).toBe("World");
    expect(post.user_id).toBe(user.id);
  });

  it("POST with missing fields returns 400", async () => {
    const user = await createUser();
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", user_id: user.id }),
    });
    expect(res.status).toBe(400);
  });

  it("POST with nonexistent user_id returns 400", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", body: "B", user_id: 99999 }),
    });
    expect(res.status).toBe(400);
  });

  it("GET lists posts ordered by created_at DESC", async () => {
    const user = await createUser();
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "First", body: "1", user_id: user.id }),
    });
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Second", body: "2", user_id: user.id }),
    });
    const res = await fetch(BASE);
    const posts = await res.json();
    expect(posts.length).toBe(2);
    // Most recent first
    expect(posts[0].title).toBe("Second");
    expect(posts[1].title).toBe("First");
  });

  it("GET /:id returns a post", async () => {
    const user = await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "X", body: "Y", user_id: user.id }),
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
    const user = await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old", body: "OldBody", user_id: user.id }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New", body: "NewBody" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("New");
    expect(updated.body).toBe("NewBody");
  });

  it("PUT can update only title", async () => {
    const user = await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Old", body: "Keep", user_id: user.id }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE removes a post", async () => {
    const user = await createUser();
    const cr = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", body: "B", user_id: user.id }),
    });
    const post = await cr.json();
    const res = await fetch(`${BASE}/${post.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const get = await fetch(`${BASE}/${post.id}`);
    expect(get.status).toBe(404);
  });

  it("DELETE returns 404 for nonexistent post", async () => {
    const res = await fetch(`${BASE}/99999`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("Deleting a user cascades to their posts", async () => {
    const user = await createUser();
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "C", body: "C", user_id: user.id }),
    });
    await fetch(`${USERS_BASE}/${user.id}`, { method: "DELETE" });
    const res = await fetch(BASE);
    const posts = await res.json();
    expect(posts.length).toBe(0);
  });
});
