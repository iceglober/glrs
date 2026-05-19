import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken, hashPassword } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3460;
const USERS = `http://localhost:${PORT}/api/users`;
const POSTS = `http://localhost:${PORT}/api/posts`;
const AUTH = `http://localhost:${PORT}/api/auth`;

let server: Server;
let userId: number;
let userToken: string;
let otherUserId: number;
let adminUserId: number;
let adminToken: string;

beforeAll(async () => {
  const { readdirSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const migrationsDir = join(import.meta.dir, "..", "migrations");
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await pool.query(readFileSync(join(migrationsDir, file), "utf-8"));
  }
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  const regRes = await fetch(`${AUTH}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "password123" }),
  });
  const regData = await regRes.json() as { user: { id: number }; token: string };
  userId = regData.user.id;
  userToken = regData.token;

  const otherRes = await fetch(`${AUTH}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bob", email: "bob@example.com", password: "password123" }),
  });
  const otherData = await otherRes.json() as { user: { id: number }; token: string };
  otherUserId = otherData.user.id;

  const ph = await hashPassword("adminpass1");
  const adminResult = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Admin", "admin@example.com", ph, "admin"],
  );
  adminUserId = adminResult.rows[0].id;
  adminToken = generateToken(adminUserId);
});

describe("GET endpoints are public", () => {
  it("GET /api/users returns 200 without Authorization", async () => {
    const res = await fetch(USERS);
    expect(res.status).toBe(200);
  });

  it("GET /api/users/:id returns 200 without Authorization", async () => {
    const res = await fetch(`${USERS}/${userId}`);
    expect(res.status).toBe(200);
  });

  it("GET /api/posts returns 200 without Authorization", async () => {
    const res = await fetch(POSTS);
    expect(res.status).toBe(200);
  });

  it("GET /api/posts/:id returns 200 without Authorization", async () => {
    const createRes = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Test", body: "Content" }),
    });
    const post = await createRes.json() as { id: number };
    const res = await fetch(`${POSTS}/${post.id}`);
    expect(res.status).toBe(200);
  });
});

describe("POST/PUT/DELETE require authentication", () => {
  it("POST /api/users without Authorization returns 401", async () => {
    const res = await fetch(USERS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", email: "new@example.com" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });

  it("PUT /api/users/:id without Authorization returns 401", async () => {
    const res = await fetch(`${USERS}/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });

  it("DELETE /api/users/:id without Authorization returns 401", async () => {
    const res = await fetch(`${USERS}/${userId}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });

  it("POST /api/posts without Authorization returns 401", async () => {
    const res = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Test", body: "Content" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });

  it("PUT /api/posts/:id without Authorization returns 401", async () => {
    const createRes = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Test", body: "Content" }),
    });
    const post = await createRes.json() as { id: number };
    const res = await fetch(`${POSTS}/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });

  it("DELETE /api/posts/:id without Authorization returns 401", async () => {
    const createRes = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
      body: JSON.stringify({ title: "Test", body: "Content" }),
    });
    const post = await createRes.json() as { id: number };
    const res = await fetch(`${POSTS}/${post.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Authentication required");
  });
});

describe("POST /api/posts uses user_id from token", () => {
  it("persists token's user_id even if body includes a different user_id", async () => {
    const res = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${userToken}` },
      body: JSON.stringify({ title: "My Post", body: "Content", user_id: otherUserId }),
    });
    expect(res.status).toBe(201);
    const post = await res.json() as { user_id: number };
    expect(post.user_id).toBe(userId);
  });
});

describe("DELETE /api/users/:id authorization", () => {
  it("non-admin deleting another user returns 403", async () => {
    const res = await fetch(`${USERS}/${otherUserId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("Forbidden");
  });

  it("admin can delete any user", async () => {
    const res = await fetch(`${USERS}/${otherUserId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(204);
  });

  it("user can delete their own account", async () => {
    const res = await fetch(`${USERS}/${userId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${userToken}` },
    });
    expect(res.status).toBe(204);
  });
});
