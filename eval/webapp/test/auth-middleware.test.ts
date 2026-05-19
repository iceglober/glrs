import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { Request, Response, NextFunction } from "express";
import { pool } from "../src/db.js";
import { generateToken, hashPassword } from "../src/auth.js";
import { requireAuth, requireAdmin } from "../src/middleware/auth.js";

function mockReq(authHeader?: string): Request {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as Request;
}

function mockRes() {
  const r = { _statusCode: 200, _body: undefined as unknown };
  return Object.assign(r, {
    status(code: number) { r._statusCode = code; return this as unknown as Response; },
    json(body: unknown) { r._body = body; return this as unknown as Response; },
  });
}

describe("requireAuth — missing/invalid token", () => {
  it("returns 401 with {error: 'Authentication required'} when Authorization header is absent", async () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    await requireAuth(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    expect(res._statusCode).toBe(401);
    expect(res._body).toEqual({ error: "Authentication required" });
    expect(nextCalled).toBe(false);
  });

  it("returns 401 when Authorization header lacks Bearer prefix", async () => {
    const req = mockReq("Basic sometoken");
    const res = mockRes();
    let nextCalled = false;
    await requireAuth(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    expect(res._statusCode).toBe(401);
    expect((res._body as { error: string }).error).toBe("Authentication required");
    expect(nextCalled).toBe(false);
  });

  it("returns 401 when token has invalid signature", async () => {
    const req = mockReq("Bearer tampered.invalidsig");
    const res = mockRes();
    let nextCalled = false;
    await requireAuth(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    expect(res._statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });
});

describe("requireAuth — valid token", () => {
  let regularUserId: number;
  let regularToken: string;

  beforeAll(async () => {
    const { readdirSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const migrationsDir = join(import.meta.dir, "..", "migrations");
    const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
      await pool.query(readFileSync(join(migrationsDir, f), "utf-8"));
    }
    await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
    const ph = await hashPassword("testpass1");
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      ["Regular", "regular@test.com", ph, "user"],
    );
    regularUserId = result.rows[0].id;
    regularToken = generateToken(regularUserId);
  });

  afterAll(async () => {
    await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
  });

  it("calls next and attaches req.user = {userId, role} for a valid token", async () => {
    const req = mockReq(`Bearer ${regularToken}`);
    const res = mockRes();
    let reached = false;
    await requireAuth(req, res as unknown as Response, (() => { reached = true; }) as NextFunction);
    expect(reached).toBe(true);
    expect(req.user).toEqual({ userId: regularUserId, role: "user" });
  });
});

describe("requireAdmin", () => {
  let regularUserId: number;
  let adminUserId: number;
  let regularToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
    const ph = await hashPassword("testpass1");

    const r1 = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      ["Regular2", "regular2@test.com", ph, "user"],
    );
    regularUserId = r1.rows[0].id;
    regularToken = generateToken(regularUserId);

    const r2 = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      ["Admin2", "admin2@test.com", ph, "admin"],
    );
    adminUserId = r2.rows[0].id;
    adminToken = generateToken(adminUserId);
  });

  afterAll(async () => {
    await pool.query("TRUNCATE sessions, posts, users RESTART IDENTITY CASCADE");
  });

  it("returns 403 with {error: 'Admin access required'} when role is 'user'", async () => {
    const req = mockReq(`Bearer ${regularToken}`);
    const res = mockRes();
    let called = false;
    await requireAdmin(req, res as unknown as Response, (() => { called = true; }) as NextFunction);
    expect(res._statusCode).toBe(403);
    expect(res._body).toEqual({ error: "Admin access required" });
    expect(called).toBe(false);
  });

  it("calls next when role is 'admin'", async () => {
    const req = mockReq(`Bearer ${adminToken}`);
    const res = mockRes();
    let called = false;
    await requireAdmin(req, res as unknown as Response, (() => { called = true; }) as NextFunction);
    expect(called).toBe(true);
    expect(req.user).toEqual({ userId: adminUserId, role: "admin" });
  });
});
