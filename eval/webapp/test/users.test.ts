import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import type { Server } from "http";

const PORT = 3457; // Use a different port for tests
const BASE = `http://localhost:${PORT}/api/users`;
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
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");
  // Re-register after truncation — the old token is invalidated when the user row is deleted
  const res = await fetch(`${AUTH_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const data = await res.json();
  authToken = data.token;
  authUserId = data.user.id;
});

describe("Users API", () => {
  it("POST /api/users creates a user and returns it", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com" }),
    });
    expect(res.status).toBe(201);
    const user = await res.json();
    expect(user.name).toBe("Alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.id).toBeDefined();
  });

  it("GET /api/users lists users", async () => {
    // Bob was registered in beforeEach — no additional POST needed
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Bob");
  });

  it("GET /api/users/:id returns a specific user", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`);
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user.name).toBe("Carol");
    expect(user.id).toBe(created.id);
  });

  it("GET /api/users/999 returns 404", async () => {
    const res = await fetch(`${BASE}/999`);
    expect(res.status).toBe(404);
  });

  it("PUT /api/users/:id updates a user", async () => {
    const createRes = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ name: "Dave", email: "dave@example.com" }),
    });
    const created = await createRes.json();

    const res = await fetch(`${BASE}/${created.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
      body: JSON.stringify({ name: "David" }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.name).toBe("David");
    expect(updated.email).toBe("dave@example.com");
  });

  it("DELETE /api/users/:id removes a user", async () => {
    // DELETE is restricted to self or admin — delete the authenticated user (self)
    const delRes = await fetch(`${BASE}/${authUserId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${BASE}/${authUserId}`);
    expect(getRes.status).toBe(404);
  });

  it("POST /api/users without auth returns 401 Authentication required", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NoAuth", email: "noauth@example.com" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("POST /api/users with invalid token returns 401", async () => {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer tampered.token" },
      body: JSON.stringify({ name: "Tampered", email: "tampered@example.com" }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Authentication required");
  });

  it("DELETE /api/users/:id by non-owner returns 403 Forbidden", async () => {
    // Register a second user
    const reg2 = await fetch(`${AUTH_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Eve", email: "eve@example.com", password: "password123" }),
    });
    const { user: user2 } = await reg2.json();

    // authToken belongs to Bob — try to delete Eve's account
    const delRes = await fetch(`${BASE}/${user2.id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${authToken}` },
    });
    expect(delRes.status).toBe(403);
    const data = await delRes.json();
    expect(data.error).toBe("Forbidden");

    // Eve's account should still exist
    const getRes = await fetch(`${BASE}/${user2.id}`);
    expect(getRes.status).toBe(200);
  });
});

describe("Pagination", () => {
  it("GET /api/users returns {data, next_cursor, has_more} envelope with one existing user", async () => {
    const res = await fetch(BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.has_more).toBe(false);
    expect(body.next_cursor).toBeNull();
  });

  it("GET /api/users?limit=1 with 2 users sets has_more=true and non-null next_cursor", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com" }),
    });
    const res = await fetch(`${BASE}?limit=1`);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");
  });

  it("GET /api/users cursor traversal covers all pages", async () => {
    await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ name: "Carol", email: "carol@example.com" }),
    });
    const p1 = await (await fetch(`${BASE}?limit=1`)).json();
    expect(p1.has_more).toBe(true);
    const p2 = await (await fetch(`${BASE}?limit=1&cursor=${p1.next_cursor}`)).json();
    expect(p2.data).toHaveLength(1);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBeNull();
  });

  it("GET /api/users with malformed cursor returns 400", async () => {
    const res = await fetch(`${BASE}?cursor=malformed`);
    expect(res.status).toBe(400);
  });
});
