/**
 * Complex webapp eval scorer — checks auth + search + analytics features.
 *
 * Designed to strain autopilot: some checks are straightforward (file exists,
 * endpoint returns 200), others require nuanced behavior (auth rejection,
 * correct aggregation, cursor pagination, tsvector search relevance).
 *
 * Usage: bun run eval/webapp/eval/score-complex.ts [webapp-dir] [--cost N] [--duration N]
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

export async function scoreComplex(webappDir: string, costUsd: number, durationS: number): Promise<ScoreResult> {
  const checks: Check[] = [];
  const pool = new pg.Pool({ connectionString: DB_URL });

  // --- Structural checks ---
  checks.push(await check("auth_migration_exists", async () =>
    fs.existsSync(path.join(webappDir, "migrations", "003_auth.sql"))));

  checks.push(await check("search_migration_exists", async () =>
    fs.existsSync(path.join(webappDir, "migrations", "004_search.sql"))));

  checks.push(await check("auth_module_exists", async () =>
    fs.existsSync(path.join(webappDir, "src", "auth.ts"))));

  checks.push(await check("auth_routes_exist", async () =>
    fs.existsSync(path.join(webappDir, "src", "routes", "auth.ts"))));

  checks.push(await check("auth_middleware_exists", async () =>
    fs.existsSync(path.join(webappDir, "src", "middleware", "auth.ts"))));

  checks.push(await check("analytics_routes_exist", async () =>
    fs.existsSync(path.join(webappDir, "src", "routes", "analytics.ts"))));

  // --- DB schema checks ---
  checks.push(await check("users_has_password_hash", async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash'"
    );
    return rows.length > 0;
  }));

  checks.push(await check("users_has_role", async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='role'"
    );
    return rows.length > 0;
  }));

  checks.push(await check("sessions_table_exists", async () => {
    const { rows } = await pool.query("SELECT to_regclass('public.sessions')");
    return rows[0]?.to_regclass !== null;
  }));

  checks.push(await check("search_vector_column", async () => {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='posts' AND column_name='search_vector'"
    );
    return rows.length > 0;
  }));

  // --- Start server for API checks ---
  let server: import("http").Server | null = null;
  try {
    // Clean state
    await pool.query("DELETE FROM posts");
    await pool.query("DELETE FROM users");
    try { await pool.query("DELETE FROM sessions"); } catch {}

    const { app } = await import(path.join(webappDir, "src", "app.ts"));
    server = app.listen(API_PORT);
    await new Promise<void>((r) => server!.on("listening", r));

    // --- Auth: Register ---
    const regRes = await api("POST", "/api/auth/register", {
      name: "Alice", email: "alice@test.com", password: "password123"
    });
    checks.push(await check("register_returns_201", async () => regRes.status === 201));
    checks.push(await check("register_returns_token", async () =>
      typeof regRes.body?.token === "string" && regRes.body.token.length > 10));

    const token = regRes.body?.token as string | undefined;

    // Duplicate email
    const dupRes = await api("POST", "/api/auth/register", {
      name: "Alice2", email: "alice@test.com", password: "password456"
    });
    checks.push(await check("register_rejects_duplicate_email", async () => dupRes.status === 409));

    // Short password
    const shortRes = await api("POST", "/api/auth/register", {
      name: "Short", email: "short@test.com", password: "abc"
    });
    checks.push(await check("register_rejects_short_password", async () => shortRes.status === 400));

    // --- Auth: Login ---
    const loginRes = await api("POST", "/api/auth/login", {
      email: "alice@test.com", password: "password123"
    });
    checks.push(await check("login_returns_200", async () =>
      loginRes.status === 200 && typeof loginRes.body?.token === "string"));

    const wrongRes = await api("POST", "/api/auth/login", {
      email: "alice@test.com", password: "wrongpassword"
    });
    checks.push(await check("login_rejects_wrong_password", async () => wrongRes.status === 401));

    // --- Auth: Protected endpoints ---
    // POST /api/posts without auth should fail
    const noAuthPost = await api("POST", "/api/posts", { title: "X", body: "Y", user_id: 1 });
    checks.push(await check("post_create_requires_auth", async () =>
      noAuthPost.status === 401));

    // POST /api/posts with auth should work
    if (token) {
      const authPost = await api("POST", "/api/posts", { title: "Test Post", body: "Hello world" }, token);
      checks.push(await check("post_create_with_auth", async () => authPost.status === 201));

      // GET should still work without auth
      const getRes = await api("GET", "/api/posts");
      checks.push(await check("get_posts_no_auth", async () => getRes.status === 200));
    } else {
      checks.push({ name: "post_create_with_auth", passed: false, detail: "no token from register" });
      checks.push({ name: "get_posts_no_auth", passed: false, detail: "no token" });
    }

    // --- Search ---
    // Create some searchable posts
    if (token) {
      await api("POST", "/api/posts", { title: "PostgreSQL Guide", body: "Learn about tsvector and full text search in PostgreSQL" }, token);
      await api("POST", "/api/posts", { title: "Node.js Tips", body: "Express middleware patterns and best practices" }, token);

      // Wait a moment for tsvector trigger
      await new Promise((r) => setTimeout(r, 200));

      const searchRes = await api("GET", "/api/posts/search?q=postgresql");
      checks.push(await check("search_returns_results", async () => {
        if (searchRes.status !== 200) return `status ${searchRes.status}`;
        const data = Array.isArray(searchRes.body) ? searchRes.body : (searchRes.body as Record<string, unknown>)?.data;
        if (!Array.isArray(data)) return "response is not an array";
        return data.length >= 1;
      }));

      const searchNoQ = await api("GET", "/api/posts/search");
      checks.push(await check("search_requires_q_param", async () =>
        searchNoQ.status === 400));

      const searchEmpty = await api("GET", "/api/posts/search?q=xyznonexistent");
      checks.push(await check("search_empty_for_no_match", async () => {
        if (searchEmpty.status !== 200) return `status ${searchEmpty.status}`;
        const data = Array.isArray(searchEmpty.body) ? searchEmpty.body : (searchEmpty.body as Record<string, unknown>)?.data;
        return Array.isArray(data) && data.length === 0;
      }));
    } else {
      for (const n of ["search_returns_results", "search_requires_q_param", "search_empty_for_no_match"]) {
        checks.push({ name: n, passed: false, detail: "no token" });
      }
    }

    // --- Pagination ---
    // Create enough posts for pagination (we already have 3, add more)
    if (token) {
      for (let i = 0; i < 5; i++) {
        await api("POST", "/api/posts", { title: `Bulk Post ${i}`, body: `Content ${i}` }, token);
      }

      const pageRes = await api("GET", "/api/posts?limit=3");
      checks.push(await check("pagination_envelope_format", async () => {
        if (pageRes.status !== 200) return `status ${pageRes.status}`;
        const body = pageRes.body as Record<string, unknown>;
        return Array.isArray(body.data) && typeof body.has_more === "boolean";
      }));

      checks.push(await check("pagination_respects_limit", async () => {
        const body = pageRes.body as Record<string, unknown>;
        const data = body.data as unknown[];
        return Array.isArray(data) && data.length === 3;
      }));

      checks.push(await check("pagination_has_cursor", async () => {
        const body = pageRes.body as Record<string, unknown>;
        return body.has_more === true && typeof body.next_cursor === "string";
      }));

      // Follow cursor
      const cursor = (pageRes.body as Record<string, unknown>).next_cursor;
      if (typeof cursor === "string") {
        const page2 = await api("GET", `/api/posts?limit=3&cursor=${cursor}`);
        checks.push(await check("pagination_cursor_works", async () => {
          if (page2.status !== 200) return `status ${page2.status}`;
          const data = (page2.body as Record<string, unknown>).data as unknown[];
          return Array.isArray(data) && data.length > 0;
        }));
      } else {
        checks.push({ name: "pagination_cursor_works", passed: false, detail: "no cursor returned" });
      }
    } else {
      for (const n of ["pagination_envelope_format", "pagination_respects_limit", "pagination_has_cursor", "pagination_cursor_works"]) {
        checks.push({ name: n, passed: false, detail: "no token" });
      }
    }

    // --- Analytics ---
    // Make Alice an admin
    await pool.query("UPDATE users SET role = 'admin' WHERE email = 'alice@test.com'");
    // Re-login to get fresh token with admin role (if the app cares)
    const adminLogin = await api("POST", "/api/auth/login", { email: "alice@test.com", password: "password123" });
    const adminToken = (adminLogin.body?.token ?? token) as string | undefined;

    if (adminToken) {
      const overviewRes = await api("GET", "/api/analytics/overview", undefined, adminToken);
      checks.push(await check("analytics_overview", async () => {
        if (overviewRes.status !== 200) return `status ${overviewRes.status}`;
        const b = overviewRes.body as Record<string, unknown>;
        return typeof b.total_users === "number" && typeof b.total_posts === "number";
      }));

      const topRes = await api("GET", "/api/analytics/top-authors?limit=5", undefined, adminToken);
      checks.push(await check("analytics_top_authors", async () => {
        if (topRes.status !== 200) return `status ${topRes.status}`;
        const data = Array.isArray(topRes.body) ? topRes.body : (topRes.body as Record<string, unknown>)?.data;
        if (!Array.isArray(data)) return "not an array";
        if (data.length === 0) return "empty";
        const first = data[0] as Record<string, unknown>;
        return typeof first.post_count === "number" || typeof first.post_count === "string";
      }));

      const activityRes = await api("GET", "/api/analytics/activity?days=7", undefined, adminToken);
      checks.push(await check("analytics_activity", async () => {
        if (activityRes.status !== 200) return `status ${activityRes.status}`;
        const data = Array.isArray(activityRes.body) ? activityRes.body : (activityRes.body as Record<string, unknown>)?.data;
        if (!Array.isArray(data)) return "not an array";
        return data.length === 7;
      }));

      // Non-admin should get 403
      const regUser = await api("POST", "/api/auth/register", {
        name: "Bob", email: "bob@test.com", password: "password123"
      });
      const userToken = regUser.body?.token as string | undefined;
      if (userToken) {
        const forbidden = await api("GET", "/api/analytics/overview", undefined, userToken);
        checks.push(await check("analytics_admin_only", async () => forbidden.status === 403));
      } else {
        checks.push({ name: "analytics_admin_only", passed: false, detail: "couldn't create regular user" });
      }

      // No auth should get 401
      const noAuth = await api("GET", "/api/analytics/overview");
      checks.push(await check("analytics_requires_auth", async () => noAuth.status === 401));
    } else {
      for (const n of ["analytics_overview", "analytics_top_authors", "analytics_activity", "analytics_admin_only", "analytics_requires_auth"]) {
        checks.push({ name: n, passed: false, detail: "no admin token" });
      }
    }

    // --- Regression: existing tests ---
    const { $ } = await import("bun");
    const testProc = $`cd ${webappDir} && DATABASE_URL=${DB_URL} bun test --timeout 30000 2>&1`.nothrow();
    const testRes = await testProc.text();
    const allPass = testRes.includes("0 fail") || (!testRes.includes("fail") && testRes.includes("pass"));
    checks.push({ name: "all_tests_pass", passed: allPass, detail: allPass ? undefined : testRes.slice(-500) });

  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(`[scorer] Server/test error: ${detail}`);
  } finally {
    if (server) server.close();
    await pool.end();
  }

  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const accuracy = total > 0 ? passed / total : 0;
  const costScore = 1 - Math.min(costUsd / COST_BUDGET_USD, 1.0);
  const speedScore = 1 - Math.min(durationS / DURATION_BUDGET_S, 1.0);
  const score = accuracy * 0.6 + costScore * 0.2 + speedScore * 0.2;

  return {
    score, accuracy, checks_passed: passed, checks_total: total, checks,
    cost_score: costScore, speed_score: speedScore,
    cost_usd: costUsd, duration_s: durationS,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const webappDir = args[0] || path.resolve(import.meta.dir, "..");
  const costIdx = args.indexOf("--cost");
  const costUsd = costIdx >= 0 ? parseFloat(args[costIdx + 1]) : 0;
  const durIdx = args.indexOf("--duration");
  const durationS = durIdx >= 0 ? parseFloat(args[durIdx + 1]) : 0;

  const result = await scoreComplex(path.resolve(webappDir), costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));

  const failed = result.checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.error(`\nFailed checks (${failed.length}/${result.checks_total}):`);
    for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  }
}
