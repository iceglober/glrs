/**
 * Webapp eval scorer — runs verification checks against the reference app
 * after autopilot has executed a plan, and computes a composite score.
 *
 * Checks:
 * 1. Migration applied (posts table exists)
 * 2. API endpoints respond correctly
 * 3. New tests pass
 * 4. Existing tests pass (no regressions)
 * 5. Frontend updated
 *
 * Usage: bun run eval/webapp/eval/score.ts <webapp-dir> [--cost <usd>] [--duration <seconds>]
 */

import * as path from "node:path";
import { $ } from "bun";

const COST_BUDGET_USD = 10.0;
const DURATION_BUDGET_S = 900;
const API_PORT = 3457;
const BASE = `http://localhost:${API_PORT}`;

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

interface ScoreResult {
  score: number;
  accuracy: number;
  checks_passed: number;
  checks_total: number;
  checks: CheckResult[];
  cost_score: number;
  speed_score: number;
  cost_usd: number;
  duration_s: number;
}

async function runCheck(name: string, fn: () => Promise<boolean | string>): Promise<CheckResult> {
  try {
    const result = await fn();
    if (typeof result === "string") {
      return { name, passed: false, detail: result };
    }
    return { name, passed: result };
  } catch (err) {
    return { name, passed: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function tableExists(webappDir: string, table: string): Promise<boolean> {
  const result = await $`cd ${webappDir} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun -e "
    import pg from 'pg';
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(\"SELECT to_regclass('public.${table}') as exists\");
    console.log(rows[0].exists ? 'yes' : 'no');
    await pool.end();
  "`.text();
  return result.trim() === "yes";
}

async function apiCheck(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function runTests(webappDir: string, testFile: string): Promise<{ passed: boolean; output: string }> {
  try {
    const result = await $`cd ${webappDir} && DATABASE_URL=postgresql://eval:eval@localhost:5433/evaldb bun test ${testFile} --timeout 30000 2>&1`.text();
    const passed = result.includes("0 fail") || (!result.includes("fail") && result.includes("pass"));
    return { passed, output: result.slice(-500) };
  } catch (err) {
    return { passed: false, output: err instanceof Error ? err.message : String(err) };
  }
}

export async function scoreWebapp(
  webappDir: string,
  costUsd: number,
  durationS: number,
): Promise<ScoreResult> {
  const checks: CheckResult[] = [];

  // 1. Migration: posts table exists
  checks.push(await runCheck("migration_applied", async () => {
    return await tableExists(webappDir, "posts");
  }));

  // 2. Posts router file exists
  checks.push(await runCheck("posts_router_exists", async () => {
    const { existsSync } = await import("fs");
    return existsSync(path.join(webappDir, "src", "routes", "posts.ts"));
  }));

  // 3. App mounts posts router
  checks.push(await runCheck("posts_router_mounted", async () => {
    const { readFileSync } = await import("fs");
    const appContent = readFileSync(path.join(webappDir, "src", "app.ts"), "utf-8");
    return appContent.includes("/api/posts") && appContent.includes("posts");
  }));

  // Start the server for API checks
  let server: import("http").Server | null = null;
  try {
    const { app } = await import(path.join(webappDir, "src", "app.ts"));
    server = app.listen(API_PORT);
    await new Promise<void>((resolve) => server!.on("listening", resolve));

    // 4. Create a user first (posts need a user_id)
    const userRes = await apiCheck("POST", "/api/users", { name: "Test User", email: "test@eval.com" });
    const userId = (userRes.body as Record<string, unknown>)?.id;

    // 5. POST /api/posts creates a post
    if (userId) {
      const createRes = await apiCheck("POST", "/api/posts", { title: "Test Post", body: "Content", user_id: userId });
      checks.push(await runCheck("create_post", async () => createRes.status === 201));

      const postId = (createRes.body as Record<string, unknown>)?.id;

      // 6. GET /api/posts lists posts
      const listRes = await apiCheck("GET", "/api/posts");
      checks.push(await runCheck("list_posts", async () => listRes.status === 200 && Array.isArray(listRes.body)));

      // 7. GET /api/posts/:id returns the post
      if (postId) {
        const getRes = await apiCheck("GET", `/api/posts/${postId}`);
        checks.push(await runCheck("get_post_by_id", async () => getRes.status === 200));
      } else {
        checks.push({ name: "get_post_by_id", passed: false, detail: "no post id from create" });
      }

      // 8. GET /api/posts/999 returns 404
      const notFoundRes = await apiCheck("GET", "/api/posts/999");
      checks.push(await runCheck("get_post_404", async () => notFoundRes.status === 404));

      // 9. DELETE /api/posts/:id
      if (postId) {
        const delRes = await apiCheck("DELETE", `/api/posts/${postId}`);
        checks.push(await runCheck("delete_post", async () => delRes.status === 204));
      } else {
        checks.push({ name: "delete_post", passed: false, detail: "no post id" });
      }
    } else {
      for (const name of ["create_post", "list_posts", "get_post_by_id", "get_post_404", "delete_post"]) {
        checks.push({ name, passed: false, detail: "user creation failed" });
      }
    }

    // 10. Frontend mentions posts
    const htmlRes = await apiCheck("GET", "/");
    checks.push(await runCheck("frontend_has_posts", async () => {
      return typeof htmlRes.body === "string" && htmlRes.body.toLowerCase().includes("post");
    }));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const name of ["create_post", "list_posts", "get_post_by_id", "get_post_404", "delete_post", "frontend_has_posts"]) {
      if (!checks.find((c) => c.name === name)) {
        checks.push({ name, passed: false, detail });
      }
    }
  } finally {
    if (server) server.close();
  }

  // 11. New tests pass
  const postsTestResult = await runTests(webappDir, "test/posts.test.ts");
  checks.push({ name: "new_tests_pass", passed: postsTestResult.passed, detail: postsTestResult.passed ? undefined : postsTestResult.output.slice(-200) });

  // 12. Existing tests still pass (regression check)
  const usersTestResult = await runTests(webappDir, "test/users.test.ts");
  checks.push({ name: "existing_tests_pass", passed: usersTestResult.passed, detail: usersTestResult.passed ? undefined : usersTestResult.output.slice(-200) });

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

  const result = await scoreWebapp(path.resolve(webappDir), costUsd, durationS);
  console.log(JSON.stringify(result, null, 2));
}
