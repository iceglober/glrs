import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initState, cleanupState, setPlansDir } from "./state.js";
import { startPlanReviewServer, type PlanReviewServer } from "./plan-server.js";
import { loadFeedback } from "./plan-feedback.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-server-test-" + process.pid);
const TEST_DB_PATH = path.join(TEST_DIR, "state.db");
const TEST_PLANS_DIR = path.join(TEST_DIR, "plans");

let server: PlanReviewServer | null = null;

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

async function startServer(content = "# Test Plan\n\n### Step 1.1 — Do thing") {
  server = await startPlanReviewServer({
    planId: "e1",
    planContent: content,
  });
  return server;
}

describe("plan review server", () => {
  test("GET / returns HTML page", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
  });

  test("POST /api/feedback appends entry", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "1.1", text: "fix this" }),
    });
    expect(res.status).toBe(200);
    const content = loadFeedback("e1");
    expect(content).toContain("fix this");
  });

  test("GET /api/feedback returns content", async () => {
    const s = await startServer();
    // First post some feedback
    await fetch(s.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "1.1", text: "looks good" }),
    });
    const res = await fetch(s.url + "/api/feedback");
    expect(res.status).toBe(200);
    const json = await res.json() as { content: string | null };
    expect(json.content).toContain("looks good");
  });

  test("GET /api/feedback returns null when empty", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/api/feedback");
    expect(res.status).toBe(200);
    const json = await res.json() as { content: string | null };
    expect(json.content).toBeNull();
  });

  test("POST /api/feedback rejects missing step", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "no step" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/feedback rejects empty text", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "1.1", text: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/feedback rejects missing text", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "1.1" }),
    });
    expect(res.status).toBe(400);
  });

  test("unknown route returns 404", async () => {
    const s = await startServer();
    const res = await fetch(s.url + "/unknown");
    expect(res.status).toBe(404);
  });

  test("server reports valid port", async () => {
    const s = await startServer();
    expect(s.port).toBeGreaterThan(0);
    expect(s.url).toBe(`http://localhost:${s.port}`);
  });
});
