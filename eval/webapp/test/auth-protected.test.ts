import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { generateToken, hashPassword } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3461;
const USERS = `http://localhost:${PORT}/api/users`;
const POSTS = `http://localhost:${PORT}/api/posts`;
const AUTH = `http://localhost:${PORT}/api/auth`;

let server: Server;
let regularToken: string;
let regularUserId: number;
let adminToken: string;
let adminUserId: number;
let otherUserId: number;

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

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");

  const ph = await hashPassword("password123");

  const r1 = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Regular", "regular@example.com", ph, "user"],
  );
  regularUserId = r1.rows[0].id;
  regularToken = generateToken(regularUserId);

  const r2 = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Admin", "admin@example.com", ph, "admin"],
  );
  adminUserId = r2.rows[0].id;
  adminToken = generateToken(adminUserId);

  const r3 = await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Other", "other@example.com", ph, "user"],
  );
  otherUserId = r3.rows[0].id;
});

// --- GET endpoints remain public ---

describe("GET /api/users — public", () => {
  it("returns 200 without any token", async () => {
    const res = await fetch(USERS);
    expect(res.status).toBe(200);
  });

  it("GET /api/users/:id returns 200 without any token", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/posts — public", () => {
  it("returns 200 without any token", async () => {
    const res = await fetch(POSTS);
    expect(res.status).toBe(200);
  });
});

// --- POST/PUT/DELETE on /api/users require auth ---

describe("POST /api/users — requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(USERS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New", email: "new@example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 201 with valid token", async () => {
    const res = await fetch(USERS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({ name: "New", email: "new@example.com" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("PUT /api/users/:id — requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid token", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/users/:id — requires auth, self-or-admin only", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when authenticated user is not the target and not admin", async () => {
    const res = await fetch(`${USERS}/${otherUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${regularToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("returns 204 when deleting self", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${regularToken}` },
    });
    expect(res.status).toBe(204);
  });

  it("returns 204 when admin deletes another user", async () => {
    const res = await fetch(`${USERS}/${regularUserId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(204);
  });
});

// --- POST/PUT/DELETE on /api/posts require auth ---

describe("POST /api/posts — requires auth", () => {
  it("returns 401 without token", async () => {
    const res = await fetch(POSTS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "World" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates post with user_id from token, ignoring body user_id", async () => {
    const res = await fetch(POSTS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({ title: "Hello", body: "World", user_id: adminUserId }),
    });
    expect(res.status).toBe(201);
    const post = await res.json() as { user_id: number };
    expect(post.user_id).toBe(regularUserId);
  });
});

describe("PUT /api/posts/:id — requires auth", () => {
  it("returns 401 without token", async () => {
    const { rows } = await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING id",
      ["Title", "Body", regularUserId],
    );
    const postId = rows[0].id;
    const res = await fetch(`${POSTS}/${postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/posts/:id — requires auth", () => {
  it("returns 401 without token", async () => {
    const { rows } = await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING id",
      ["Title", "Body", regularUserId],
    );
    const postId = rows[0].id;
    const res = await fetch(`${POSTS}/${postId}`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 204 with valid token", async () => {
    const { rows } = await pool.query(
      "INSERT INTO posts (title, body, user_id) VALUES ($1, $2, $3) RETURNING id",
      ["Title", "Body", regularUserId],
    );
    const postId = rows[0].id;
    const res = await fetch(`${POSTS}/${postId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${regularToken}` },
    });
    expect(res.status).toBe(204);
  });
});
