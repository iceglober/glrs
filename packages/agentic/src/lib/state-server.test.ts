import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, setPlansDir, createEpic, createTask, savePlan, createReview, addReviewItem } from "./state.js";
import { getDbSync } from "./db.js";
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

  test("path traversal rejected", async () => {
    const s = await start();
    const res = await fetch(s.url + "/api/plan/..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Invalid plan ID");
  });

  test("no CORS header on responses", async () => {
    const s = await start();
    const res = await fetch(s.url + "/api/state");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("standalone tasks in /api/state", async () => {
    createTask({ title: "Orphan" });
    const s = await start();
    const res = await fetch(s.url + "/api/state");
    const json = await res.json() as any;
    expect(json.standalone.length).toBe(1);
    expect(json.standalone[0].title).toBe("Orphan");
  });

  test("epic has derivedPhase", async () => {
    createEpic({ title: "Ep" });
    createTask({ title: "T", epic: "e1" });
    const s = await start();
    const json = await (await fetch(s.url + "/api/state")).json() as any;
    expect(json.epics[0]).toHaveProperty("derivedPhase");
  });

  test("epic has reviewSummary when tasks have reviews", async () => {
    createEpic({ title: "Rev Epic" });
    createTask({ title: "Rev Task", epic: "e1" });
    const review = createReview({ taskId: "t1", source: "test", commitSha: "abc" });
    addReviewItem({ reviewId: review.id, body: "Finding", severity: "HIGH" });
    const s = await start();
    const json = await (await fetch(s.url + "/api/state")).json() as any;
    expect(json.epics[0].reviewSummary).toBeDefined();
    expect(json.epics[0].reviewSummary.total).toBeGreaterThan(0);
  });

  test("tasks do not have steps field", async () => {
    createEpic({ title: "Ep" });
    createTask({ title: "T", epic: "e1" });
    const s = await start();
    const json = await (await fetch(s.url + "/api/state")).json() as any;
    expect(json.epics[0].tasks[0]).not.toHaveProperty("steps");
  });

  test("custom port binding", async () => {
    server = await startStateServer({ port: 19876 });
    expect(server.port).toBe(19876);
    expect(server.url).toContain("19876");
  });

  test("GET /api/state?all=true returns cross-repo data", async () => {
    createEpic({ title: "Local Epic" });
    // Insert a foreign-repo epic directly
    const db = getDbSync();
    db.run(
      "INSERT INTO epics (id, repo, title, description, phase, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["e1", "other-repo", "Foreign Epic", "", "understand", new Date().toISOString(), new Date().toISOString()],
    );
    const s = await start();

    // Default: only local
    const localRes = await fetch(s.url + "/api/state");
    const localJson = await localRes.json() as any;
    expect(localJson.epics).toHaveLength(1);
    expect(localJson.epics[0].title).toBe("Local Epic");

    // all=true: both repos
    const allRes = await fetch(s.url + "/api/state?all=true");
    const allJson = await allRes.json() as any;
    expect(allJson.epics).toHaveLength(2);
    const titles = allJson.epics.map((e: any) => e.title);
    expect(titles).toContain("Local Epic");
    expect(titles).toContain("Foreign Epic");
  });

  test("GET /api/state?all=false returns local only", async () => {
    createEpic({ title: "Mine" });
    const db = getDbSync();
    db.run(
      "INSERT INTO epics (id, repo, title, description, phase, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["e1", "other-repo", "Theirs", "", "understand", new Date().toISOString(), new Date().toISOString()],
    );
    const s = await start();
    const res = await fetch(s.url + "/api/state?all=false");
    const json = await res.json() as any;
    expect(json.epics).toHaveLength(1);
    expect(json.epics[0].title).toBe("Mine");
  });
});
