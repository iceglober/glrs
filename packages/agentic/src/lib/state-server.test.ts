import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, setPlansDir, createEpic, createTask, savePlan, createReview, addReviewItem } from "./state.js";
import { startStateServer, type StateServer } from "./state-server.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-state-server-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");
const TEST_PLANS_DIR = path.join(TEST_DIR, "plans");

let server: StateServer | null = null;

beforeEach(async () => {
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  await initState(TEST_DB_PATH);
  setPlansDir(TEST_PLANS_DIR);
});

afterEach(() => {
  if (server) {
    server.close();
    server = null;
  }
  setPlansDir(null);
  cleanupState();
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

async function start() {
  server = await startStateServer();
  return server;
}

describe("state server", () => {
  test("GET / returns HTML page", async () => {
    const s = await start();
    const res = await fetch(s.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  test("GET /api/state returns JSON with epics and standalone", async () => {
    const s = await start();
    const res = await fetch(s.url + "/api/state");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json() as any;
    expect(Array.isArray(json.epics)).toBe(true);
    expect(Array.isArray(json.standalone)).toBe(true);
  });

  test("GET /api/state includes tasks under epics", async () => {
    createEpic({ title: "Test Epic" });
    createTask({ title: "Test Task", epic: "e1" });
    const s = await start();
    const res = await fetch(s.url + "/api/state");
    const json = await res.json() as any;
    expect(json.epics.length).toBe(1);
    expect(json.epics[0].tasks.length).toBe(1);
  });

  test("GET /api/plan/:id returns plan content", async () => {
    createEpic({ title: "Plan Epic" });
    savePlan("e1", "# My Plan");
    const s = await start();
    const res = await fetch(s.url + "/api/plan/e1");
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.content).toBe("# My Plan");
  });

  test("GET /api/plan/:id returns null for missing", async () => {
    const s = await start();
    const res = await fetch(s.url + "/api/plan/e99");
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.content).toBeNull();
  });

  test("GET /api/state includes review summary", async () => {
    createEpic({ title: "Review Epic" });
    createTask({ title: "Review Task", epic: "e1" });
    const review = createReview({ taskId: "t1", source: "test", commitSha: "abc123" });
    addReviewItem({ reviewId: review.id, body: "Test finding", severity: "HIGH" });
    const s = await start();
    const res = await fetch(s.url + "/api/state");
    const json = await res.json() as any;
    const task = json.epics[0].tasks[0];
    expect(task.reviewSummary).toBeDefined();
    expect(task.reviewSummary.total).toBeGreaterThan(0);
  });

  test("unknown route returns 404", async () => {
    const s = await start();
    const res = await fetch(s.url + "/unknown");
    expect(res.status).toBe(404);
  });

  test("server reports valid port", async () => {
    const s = await start();
    expect(s.port).toBeGreaterThan(0);
    expect(s.url).toBe(`http://localhost:${s.port}`);
  });
});
