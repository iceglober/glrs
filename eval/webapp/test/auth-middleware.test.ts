import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import express from "express";
import { pool } from "../src/db.js";
import { generateToken } from "../src/auth.js";
import { requireAuth, requireAdmin } from "../src/middleware/auth.js";
import type { Server } from "http";

const PORT = 3460;
const BASE = `http://localhost:${PORT}`;

let server: Server;
let userToken: string;
let adminToken: string;
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

  const testApp = express();
  testApp.use(express.json());

  testApp.get("/protected", requireAuth, (req, res) => {
    res.json({ userId: req.user!.userId, role: req.user!.role });
  });

  testApp.get("/admin-only", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });

  server = testApp.listen(PORT);
  await new Promise<void>((resolve) => server.on("listening", resolve));
});

afterAll(async () => {
  server.close();
});

beforeEach(async () => {
  await pool.query("TRUNCATE posts, users RESTART IDENTITY CASCADE");

  const { rows: [user] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('User', 'user@test.com', 'user') RETURNING id",
  );
  userId = user.id;
  userToken = generateToken(userId);

  const { rows: [admin] } = await pool.query(
    "INSERT INTO users (name, email, role) VALUES ('Admin', 'admin@test.com', 'admin') RETURNING id",
  );
  const adminId = admin.id;
  adminToken = generateToken(adminId);
});

describe("requireAuth middleware", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await fetch(`${BASE}/protected`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });

  it("returns 401 when Authorization header has no Bearer prefix", async () => {
    const res = await fetch(`${BASE}/protected`, {
      headers: { Authorization: "Token abc123" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });

  it("returns 401 when token is invalid", async () => {
    const res = await fetch(`${BASE}/protected`, {
      headers: { Authorization: "Bearer not-a-valid-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });

  it("sets req.user and calls next with valid token", async () => {
    const res = await fetch(`${BASE}/protected`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(userId);
    expect(body.role).toBe("user");
  });
});

describe("requireAdmin middleware", () => {
  it("returns 403 when user is not admin", async () => {
    const res = await fetch(`${BASE}/admin-only`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Admin access required" });
  });

  it("calls next when user is admin", async () => {
    const res = await fetch(`${BASE}/admin-only`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 401 when no token is provided", async () => {
    const res = await fetch(`${BASE}/admin-only`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });
});
