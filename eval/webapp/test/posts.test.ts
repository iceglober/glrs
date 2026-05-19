import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3458; // Use a different port for tests (3457 is used by users tests)
const BASE = `http://localhost:${PORT}/api/posts`;
const AUTH_BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;
let authToken: string;
let authUserId: number;

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
  await pool.query("TRUNCATE posts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE users RESTART IDENTITY CASCADE");
  // Re-register after truncation — the old token is invalidated when the user row is deleted
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;
  authUserId = data.user.id;
});

describe("Posts API", () => {
  it("POST /api/posts creates a post and returns it", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Hello", body: "World" }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.title).toBe("Hello");
    expect(post.body).toBe("World");
    expect(post.user_id).toBe(authUserId);
    expect(post.id).toBeDefined();
  });

  it("GET /api/posts lists posts", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Post 1", body: "Body 1" }),
    });
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("Post 1");
  });

  it("GET /api/posts/:id returns a specific post", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Specific", body: "Post" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    const post = await res.json();
    expect(post.title).toBe("Specific");
    expect(post.id).toBe(created.id);
  });

  it("GET /api/posts/999 returns 404", async () => {
    const res = await fetch(`${BASE}/999`);
    expect(res.status).toBe(404);
  });

  it("PUT /api/posts/:id updates a post", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Old Title", body: "Old Body" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "New Title" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe("New Title");
    expect(updated.body).toBe("Old Body");
  });

  it("DELETE /api/posts/:id removes a post", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Gone", body: "Soon" }),
    });
    const created = await createRes.json();

    const delRes = await fetch(`${BASE}/${created.id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE}/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  it("POST /api/posts without auth fails", async () => {
    // user_id from body is no longer accepted; auth token is required
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "No Auth", body: "Unauthorized" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });
});

describe("Pagination", () => {
  it("GET /api/posts returns {data, next_cursor, has_more} envelope", async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
  });

  it("GET /api/posts?limit=2 with 3 posts sets has_more=true and non-null next_cursor", async () => {
    for (let i = 1; i <= 3; i++) {
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }
    const res = await fetch(`${BASE}?limit=2`);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");
  });

  it("GET /api/posts cursor traversal covers all pages", async () => {
    for (let i = 1; i <= 3; i++) {
      await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: `Post ${i}`, body: `Body ${i}` }),
      });
    }
    const p1 = await (await fetch(`${BASE}?limit=2`)).json();
    expect(p1.has_more).toBe(true);
    const p2 = await (await fetch(`${BASE}?limit=2&cursor=${p1.next_cursor}`)).json();
    expect(p2.data).toHaveLength(1);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBeNull();
  });

  it("GET /api/posts with malformed cursor returns 400", async () => {
    const res = await fetch(`${BASE}?cursor=malformed`);
    expect(res.status).toBe(400);
  });
});

describe("Search", () => {
  it("search_vector column and GIN index exist in pg_indexes", async () => {
    const { rows: colRows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'posts' AND column_name = 'search_vector'`,
    );
    expect(colRows.length).toBe(1);

    const { rows: idxRows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'posts' AND indexdef ILIKE '%using gin%' AND indexdef ILIKE '%search_vector%'`,
    );
    expect(idxRows.length).toBeGreaterThan(0);
  });

  it("trigger populates search_vector on INSERT", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Tutorial Post", body: "Learning database concepts" }),
    });
    const post = await createRes.json();
    const { rows } = await pool.query(
      "SELECT search_vector::text FROM posts WHERE id = $1",
      [post.id],
    );
    expect(rows[0].search_vector).not.toBeNull();
    expect((rows[0].search_vector as string).length).toBeGreaterThan(0);
  });

  it("trigger updates search_vector on UPDATE", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Old Title", body: "Old body content" }),
    });
    const post = await createRes.json();

    await fetch(`${BASE}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ body: "New body with elephant content" }),
    });

    const { rows } = await pool.query(
      "SELECT search_vector::text FROM posts WHERE id = $1",
      [post.id],
    );
    expect(rows[0].search_vector as string).toContain("eleph");
  });

  it("GET /api/posts/search?q=<term> returns rows with headline containing <b> tags", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title: "Database Guide", body: "Learn about relational databases and SQL" }),
    });
    const res = await fetch(`${BASE}/search?q=database`);
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].headline).toContain("<b>");
  });

  it("GET /api/posts/search without q returns 400", async () => {
    const res = await fetch(`${BASE}/search`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("q is required");
  });
});
