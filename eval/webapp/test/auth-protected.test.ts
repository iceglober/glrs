import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3461;
const USERS_BASE = `http://localhost:${PORT}/api/users`;
const POSTS_BASE = `http://localhost:${PORT}/api/posts`;

let server: Server;
let userToken: string;
let userId: number;
let otherUserId: number;
let adminToken: string;
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
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  const { rows: [user] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Alice', 'alice@test.com', 'user') RETURNING id",
  );
  userId = user.id;
  userToken = generateToken(userId);

  const { rows: [other] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Bob', 'bob@test.com', 'user') RETURNING id",
  );
  otherUserId = other.id;

  const { rows: [admin] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Admin', 'admin@test.com', 'admin') RETURNING id",
  );
  adminToken = generateToken(admin.id);

  const { rows: [post] } = await pool.query(
    "INSERT INTO posts (title, body, user_id) VALUES ('Test Post', 'Test body', $1) RETURNING id",
    [userId],
  );
  postId = post.id;
});

describe("GET endpoints are public", () => {
  it("GET /api/users returns 200 without Authorization header", async () => {
    const res = await fetch(USERS_BASE);
    expect(res.status).toBe(200);
  });

  it("GET /api/posts returns 200 without Authorization header", async () => {
    const res = await fetch(POSTS_BASE);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/users requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(USERS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New User", email: "new@test.com" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/users/:id requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${USERS_BASE}/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/users/:id requires auth and self-or-admin", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${USERS_BASE}/${userId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when deleting another user with non-admin token", async () => {
    const res = await fetch(`${USERS_BASE}/${otherUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 204 when deleting self", async () => {
    const res = await fetch(`${USERS_BASE}/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(204);
  });

  it("returns 204 when admin deletes another user", async () => {
    const res = await fetch(`${USERS_BASE}/${otherUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/posts requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(POSTS_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Post", body: "New body" }),
    });
    expect(res.status).toBe(401);
  });

  it("auto-sets user_id from token without user_id in body", async () => {
    const res = await fetch(POSTS_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ title: "Token Post", body: "Created via token" }),
    });
    expect(res.status).toBe(201);
    const post = await res.json();
    expect(post.user_id).toBe(userId);
  });
});

describe("PUT /api/posts/:id requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${POSTS_BASE}/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/posts/:id requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${POSTS_BASE}/${postId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});
