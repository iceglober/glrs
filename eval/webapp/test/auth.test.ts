import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { pool } from "../src/db.js";
import { app } from "../src/app.js";
import { hashPassword, verifyPassword, generateToken, verifyToken } from "../src/auth.js";
import type { Server } from "http";

const PORT = 3456;
const BASE = `http://localhost:${PORT}/api/auth`;

let server: Server;

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
});

describe("Authentication", () => {
  describe("POST /api/auth/register", () => {
    it("creates a user and returns 201 with {user, token}", async () => {
      const res = await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          password: "password123",
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.id).toBeDefined();
      expect(data.user.name).toBe("Alice");
      expect(data.user.email).toBe("alice@example.com");
      expect(data.user.role).toBe("user");
      expect(typeof data.token).toBe("string");
    });

    it("returns 409 on duplicate email", async () => {
      await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice",
          email: "alice@example.com",
          password: "password123",
        }),
      });

      const res = await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Alice2",
          email: "alice@example.com",
          password: "password123",
        }),
      });
      expect(res.status).toBe(409);
    });

    it("returns 400 on password < 8 characters", async () => {
      const res = await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bob",
          email: "bob@example.com",
          password: "short",
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBeDefined();
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns 200 with {user, token} on correct credentials", async () => {
      await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Carol",
          email: "carol@example.com",
          password: "password123",
        }),
      });

      const res = await fetch(`${BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "carol@example.com",
          password: "password123",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe("carol@example.com");
      expect(typeof data.token).toBe("string");
    });

    it("returns 401 on wrong password", async () => {
      await fetch(`${BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Dave",
          email: "dave@example.com",
          password: "password123",
        }),
      });

      const res = await fetch(`${BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "dave@example.com",
          password: "wrongpassword",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 on unknown email", async () => {
      const res = await fetch(`${BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "unknown@example.com",
          password: "password123",
        }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Token utilities", () => {
    it("verifyToken(generateToken(userId)) returns {userId}", () => {
      const userId = 42;
      const token = generateToken(userId);
      const payload = verifyToken(token);
      expect(payload).toBeDefined();
      expect(payload?.userId).toBe(userId);
    });

    it("verifyToken returns null for invalid token", () => {
      const payload = verifyToken("invalid.token");
      expect(payload).toBeNull();
    });

    it("hashPassword and verifyPassword round-trip returns true", async () => {
      const password = "mypassword";
      const hash = await hashPassword(password);
      const matches = await verifyPassword(password, hash);
      expect(matches).toBe(true);
    });

    it("verifyPassword returns false for wrong password", async () => {
      const password = "mypassword";
      const hash = await hashPassword(password);
      const matches = await verifyPassword("wrongpassword", hash);
      expect(matches).toBe(false);
    });
  });
});
