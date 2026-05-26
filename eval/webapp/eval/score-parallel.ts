/**
 * Parallel features eval scorer — checks comments, tags, and bookmarks.
 *
 * 18 checks across three independent features. Tests both structural
 * correctness (files exist, tables created) and behavioral correctness
 * (CRUD operations, auth enforcement, error handling).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import pg from "pg";

const COST_BUDGET_USD = 20.0;
const DURATION_BUDGET_S = 1200;
const API_PORT = 3470;
const BASE = `http://localhost:${API_PORT}`;
const DB_URL = "postgresql://eval:eval@localhost:5433/evaldb";

interface Check { name: string; passed: boolean; detail?: string }
interface ScoreResult {
  score: number; accuracy: number;
  checks_passed: number; checks_total: number; checks: Check[];
  cost_score: number; speed_score: number;
  cost_usd: number; duration_s: number;
}

async function check(name: string, fn: () => Promise<boolean | string>): Promise<Check> {
  try {
    const r = await fn();
    return typeof r === "string" ? { name, passed: false, detail: r } : { name, passed: r };
  } catch (e) {
    return { name, passed: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

export async function scoreParallel(webappDir: string, costUsd: number, durationS: number): Promise<ScoreResult> {
  const checks: Check[] = [];
  const pool = new pg.Pool({ connectionString: DB_URL });

  // --- Structural checks (6) ---
  checks.push(await check("comments_migration_exists", async () =>
    fs.existsSync(path.join(webappDir, "migrations", "005_create_comments.sql"))));

  checks.push(await check("tags_migration_exists", async () =>
    fs.existsSync(path.join(webappDir, "migrations", "006_create_tags.sql"))));

  checks.push(await check("bookmarks_migration_exists", async () =>
    fs.existsSync(path.join(webappDir, "migrations", "007_create_bookmarks.sql"))));

  checks.push(await check("comments_routes_exist", async () =>
    fs.existsSync(path.join(webappDir, "src", "routes", "comments.ts"))));

  checks.push(await check("tags_routes_exist", async () =>
    fs.existsSync(path.join(webappDir, "src", "routes", "tags.ts"))));

  checks.push(await check("bookmarks_routes_exist", async () =>
    fs.existsSync(path.join(webappDir, "src", "routes", "bookmarks.ts"))));

  // --- DB schema checks (3) ---
  checks.push(await check("comments_table_exists", async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name='comments'"
    );
    return rows.length > 0;
  }));

  checks.push(await check("tags_table_exists", async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name='tags'"
    );
    return rows.length > 0;
  }));

  checks.push(await check("bookmarks_table_exists", async () => {
    const { rows } = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_name='bookmarks'"
    );
    return rows.length > 0;
  }));

  // --- Start the app for API checks ---
  let server: ReturnType<typeof import("net").createServer> | null = null;
  try {
    const appModule = await import(path.join(webappDir, "src", "app.ts"));
    const app = appModule.default || appModule.app;
    server = app.listen(API_PORT);
    await new Promise((r) => setTimeout(r, 500));

    // Register a test user for auth
    const reg = await api("POST", "/api/auth/register", {
      name: "eval-user", email: "eval-parallel@test.com", password: "testpass123",
    });
    const token = reg.body?.token as string;

    // Create a post for testing comments/tags/bookmarks
    const postRes = await api("POST", "/api/posts", {
      title: "Test Post", body: "Test body", user_id: (reg.body?.user as any)?.id,
    }, token);
    const postId = (postRes.body as any)?.id;

    // --- Comments API checks (3) ---
    checks.push(await check("create_comment", async () => {
      const r = await api("POST", `/api/posts/${postId}/comments`, { body: "Nice post!" }, token);
      return r.status === 201 || `Expected 201, got ${r.status}`;
    }));

    checks.push(await check("list_comments", async () => {
      const r = await api("GET", `/api/posts/${postId}/comments`, undefined, token);
      const items = Array.isArray(r.body) ? r.body : (r.body as any)?.comments;
      return (r.status === 200 && Array.isArray(items) && items.length > 0) ||
        `Expected 200 with comments array, got ${r.status}`;
    }));

    checks.push(await check("comments_require_auth", async () => {
      const r = await api("POST", `/api/posts/${postId}/comments`, { body: "No auth" });
      return r.status === 401 || r.status === 403 || `Expected 401/403, got ${r.status}`;
    }));

    // --- Tags API checks (3) ---
    checks.push(await check("create_tag", async () => {
      const r = await api("POST", "/api/tags", { name: "javascript" }, token);
      return r.status === 201 || `Expected 201, got ${r.status}`;
    }));

    checks.push(await check("list_tags", async () => {
      const r = await api("GET", "/api/tags", undefined, token);
      const items = Array.isArray(r.body) ? r.body : (r.body as any)?.tags;
      return (r.status === 200 && Array.isArray(items) && items.length > 0) ||
        `Expected 200 with tags array, got ${r.status}`;
    }));

    checks.push(await check("reject_duplicate_tag", async () => {
      const r = await api("POST", "/api/tags", { name: "javascript" }, token);
      return r.status === 409 || `Expected 409 for duplicate, got ${r.status}`;
    }));

    // --- Bookmarks API checks (3) ---
    checks.push(await check("create_bookmark", async () => {
      const r = await api("POST", "/api/bookmarks", { postId }, token);
      return r.status === 201 || `Expected 201, got ${r.status}`;
    }));

    checks.push(await check("list_bookmarks", async () => {
      const r = await api("GET", "/api/bookmarks", undefined, token);
      const items = Array.isArray(r.body) ? r.body : (r.body as any)?.bookmarks;
      return (r.status === 200 && Array.isArray(items) && items.length > 0) ||
        `Expected 200 with bookmarks array, got ${r.status}`;
    }));

    checks.push(await check("reject_duplicate_bookmark", async () => {
      const r = await api("POST", "/api/bookmarks", { postId }, token);
      return r.status === 409 || `Expected 409 for duplicate, got ${r.status}`;
    }));

  } finally {
    if (server) (server as any).close();
    await pool.end();
  }

  // --- Score ---
  const passed = checks.filter((c) => c.passed).length;
  const accuracy = passed / checks.length;
  const costScore = 1 - Math.min(costUsd / COST_BUDGET_USD, 1.0);
  const speedScore = 1 - Math.min(durationS / DURATION_BUDGET_S, 1.0);
  const score = accuracy * 0.6 + costScore * 0.2 + speedScore * 0.2;

  return {
    score, accuracy,
    checks_passed: passed, checks_total: checks.length, checks,
    cost_score: costScore, speed_score: speedScore,
    cost_usd: costUsd, duration_s: durationS,
  };
}
