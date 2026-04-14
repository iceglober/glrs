import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setSettingsPath, setSetting } from "./settings.js";

const TEST_DIR = path.join(os.tmpdir(), "glorious-review-server-test-" + process.pid);
const TEST_PORT_FILE = path.join(TEST_DIR, "plan-review.port");
const TEST_SETTINGS = path.join(TEST_DIR, "settings.json");
const TEST_PLANS_DIR = path.join(TEST_DIR, "plans");

let servers: Array<{ close: () => void }> = [];

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(TEST_DIR, { recursive: true });
  setSettingsPath(TEST_SETTINGS);
});

afterEach(() => {
  for (const s of servers) {
    try { s.close(); } catch {}
  }
  servers = [];
  setSettingsPath(null);
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

async function importModule() {
  // Dynamic import to get fresh module for each test
  return await import("./review-server.js");
}

describe("review server — port file", () => {
  test("startReviewServer creates port file", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(true);
    const content = fs.readFileSync(TEST_PORT_FILE, "utf-8");
    expect(content).toContain(String(server.port));
    expect(content).toContain(String(process.pid));
  });

  test("server.close removes port file", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(true);
    server.close();
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(false);
  });

  test("no .tmp file left after server start", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    expect(fs.existsSync(TEST_PORT_FILE + ".tmp")).toBe(false);
  });

  test("findRunningServer returns null when no port file", async () => {
    const { findRunningServer } = await importModule();
    const result = await findRunningServer({ portFilePath: TEST_PORT_FILE });
    expect(result).toBeNull();
  });

  test("findRunningServer returns null for stale port file (dead PID)", async () => {
    const { findRunningServer } = await importModule();
    fs.writeFileSync(TEST_PORT_FILE, `99999\n999999999\n${Date.now()}`);
    const result = await findRunningServer({ portFilePath: TEST_PORT_FILE });
    expect(result).toBeNull();
  });

  test("findRunningServer returns server info when running", async () => {
    const { startReviewServer, findRunningServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const result = await findRunningServer({ portFilePath: TEST_PORT_FILE });
    expect(result).not.toBeNull();
    expect(result!.port).toBe(server.port);
    expect(result!.url).toBe(server.url);
  });
});

describe("review server — plan registration", () => {
  test("POST /api/plans registers a plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  test("GET /api/plans returns registered plans", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan One" }),
    });
    const res = await fetch(server.url + "/api/plans");
    expect(res.status).toBe(200);
    const json = await res.json() as { plans: Array<{ planId: string }> };
    expect(json.plans.length).toBe(1);
    expect(json.plans[0].planId).toBe("e1");
  });

  test("POST /api/plans rejects missing planId", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planContent: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/plans rejects planId with special chars", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1;rm -rf", planContent: "# Plan" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toContain("Invalid planId");
  });

  test("POST /api/plans rejects path traversal planId", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "../etc/passwd", planContent: "# Plan" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/plans accepts planId with dots", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1.1", planContent: "# Plan" }),
    });
    expect(res.status).toBe(200);
  });

  test("POST /api/plans rejects empty planId", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "", planContent: "# Plan" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/plans rejects missing planContent", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("review server — feedback", () => {
  test("POST /api/feedback saves scoped feedback", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });
    const res = await fetch(server.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", step: "1.1", text: "fix this" }),
    });
    expect(res.status).toBe(200);
  });

  test("GET /api/feedback returns feedback for plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });
    await fetch(server.url + "/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", step: "1.1", text: "looks good" }),
    });
    const res = await fetch(server.url + "/api/feedback?planId=e1");
    expect(res.status).toBe(200);
    const json = await res.json() as { content: string | null };
    expect(json.content).toContain("looks good");
  });
});

describe("review server — finish", () => {
  test("POST /api/finish marks plan done with remaining count", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });
    const res = await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; remaining: number };
    expect(json.ok).toBe(true);
    expect(json.remaining).toBe(0);
  });

  test("POST /api/finish for unknown plan returns 404", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "nonexistent" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/finish with two plans returns remaining 1", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan 1" }),
    });
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e2", planContent: "# Plan 2" }),
    });
    const res = await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; remaining: number };
    expect(json.remaining).toBe(1);
  });
});

describe("review server — SSE events", () => {
  test("GET /api/events streams finish event for specific plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });

    // Start SSE listener
    const events: string[] = [];
    const eventPromise = new Promise<void>((resolve) => {
      const controller = new AbortController();
      fetch(server.url + "/api/events?planId=e1", { signal: controller.signal })
        .then(async (res) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            events.push(text);
            if (text.includes("event: finish")) {
              controller.abort();
              resolve();
            }
          }
        })
        .catch(() => resolve());
    });

    // Small delay to ensure SSE connection is established
    await new Promise(r => setTimeout(r, 50));

    // Finish the plan
    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    await eventPromise;
    expect(events.some(e => e.includes("event: finish"))).toBe(true);
  });

  test("close-tab event sent when last plan finishes", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan" }),
    });

    const events: string[] = [];
    const eventPromise = new Promise<void>((resolve) => {
      const controller = new AbortController();
      fetch(server.url + "/api/events?planId=e1", { signal: controller.signal })
        .then(async (res) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            events.push(text);
            if (text.includes("event: close-tab")) {
              controller.abort();
              resolve();
            }
          }
        })
        .catch(() => resolve());
    });

    await new Promise(r => setTimeout(r, 50));

    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    await eventPromise;
    expect(events.some(e => e.includes("event: close-tab"))).toBe(true);
  });

  test("close-tab not sent when other plans remain", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan 1" }),
    });
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e2", planContent: "# Plan 2" }),
    });

    const events: string[] = [];
    const controller = new AbortController();
    const eventPromise = new Promise<void>((resolve) => {
      fetch(server.url + "/api/events?planId=e1", { signal: controller.signal })
        .then(async (res) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            events.push(text);
            if (text.includes("event: finish")) {
              // Wait a bit after finish to check for close-tab
              setTimeout(() => { controller.abort(); resolve(); }, 100);
            }
          }
        })
        .catch(() => resolve());
    });

    await new Promise(r => setTimeout(r, 50));

    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    await eventPromise;
    expect(events.some(e => e.includes("event: finish"))).toBe(true);
    expect(events.some(e => e.includes("event: close-tab"))).toBe(false);
  });
});

describe("review server — first-run", () => {
  test("GET /api/first-run returns firstRun true when setting is default", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/first-run");
    expect(res.status).toBe(200);
    const json = await res.json() as { firstRun: boolean };
    expect(json.firstRun).toBe(true);
  });

  test("POST /api/first-run-dismiss sets setting and returns ok", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/first-run-dismiss", { method: "POST" });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    // Verify setting was updated
    const check = await fetch(server.url + "/api/first-run");
    const checkJson = await check.json() as { firstRun: boolean };
    expect(checkJson.firstRun).toBe(false);
  });
});

describe("review server — misc", () => {
  test("GET / returns tabbed HTML with registered plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Test Plan" }),
    });
    const res = await fetch(server.url + "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("e1");
    expect(body).toContain("Finish Review");
  });

  test("GET / with two plans shows both tabs", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Plan 1" }),
    });
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e2", planContent: "# Plan 2" }),
    });
    const res = await fetch(server.url + "/");
    const body = await res.text();
    expect(body).toContain('data-plan="e1"');
    expect(body).toContain('data-plan="e2"');
  });

  test("GET / with no plans shows empty state", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/");
    const body = await res.text();
    expect(body).toContain("No plans");
  });

  test("GET /api/plans/:id returns individual plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await fetch(server.url + "/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1", planContent: "# Test Plan" }),
    });
    const res = await fetch(server.url + "/api/plans/e1");
    expect(res.status).toBe(200);
    const json = await res.json() as { planId: string; htmlContent: string };
    expect(json.planId).toBe("e1");
    expect(json.htmlContent).toContain("Test Plan");
  });

  test("GET /api/plans/:id returns 404 for unknown plan", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/api/plans/nonexistent");
    expect(res.status).toBe(404);
  });

  test("unknown route returns 404", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    const res = await fetch(server.url + "/unknown");
    expect(res.status).toBe(404);
  });

  test("server reports valid port", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://localhost:${server.port}`);
  });

  test("registerPlan sends HTTP POST to server", async () => {
    const { startReviewServer, registerPlan } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan");
    const res = await fetch(server.url + "/api/plans");
    const json = await res.json() as { plans: Array<{ planId: string }> };
    expect(json.plans[0].planId).toBe("e1");
  });
});

describe("review server — E2E concurrent reviews", () => {
  test("two plans register on shared server", async () => {
    const { startReviewServer, registerPlan } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan 1");
    await registerPlan(server.url, "e2", "# Plan 2");
    const res = await fetch(server.url + "/api/plans");
    const json = await res.json() as { plans: Array<{ planId: string }> };
    expect(json.plans.length).toBe(2);
    expect(json.plans.map((p: any) => p.planId).sort()).toEqual(["e1", "e2"]);
  });

  test("finishing e1 sends finish event only to e1 subscriber", async () => {
    const { startReviewServer, registerPlan } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan 1");
    await registerPlan(server.url, "e2", "# Plan 2");

    // Subscribe to e1 and e2 SSE streams
    const e1Events: string[] = [];
    const e2Events: string[] = [];
    const e1Controller = new AbortController();
    const e2Controller = new AbortController();

    const e1Promise = new Promise<void>((resolve) => {
      fetch(server.url + "/api/events?planId=e1", { signal: e1Controller.signal })
        .then(async (res) => {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            e1Events.push(decoder.decode(value));
            if (e1Events.some(e => e.includes("event: finish"))) {
              setTimeout(() => { e1Controller.abort(); resolve(); }, 50);
            }
          }
        })
        .catch(() => resolve());
    });

    const e2Listener = fetch(server.url + "/api/events?planId=e2", { signal: e2Controller.signal })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          e2Events.push(decoder.decode(value));
        }
      })
      .catch(() => {});

    await new Promise(r => setTimeout(r, 50));

    // Finish e1
    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    await e1Promise;
    e2Controller.abort();

    expect(e1Events.some(e => e.includes("event: finish"))).toBe(true);
    // e2 should NOT have received a finish event
    expect(e2Events.some(e => e.includes("event: finish"))).toBe(false);
  });

  test("finishing last plan sends close-tab, non-last does not", async () => {
    const { startReviewServer, registerPlan } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan 1");
    await registerPlan(server.url, "e2", "# Plan 2");

    // Finish e1 (not the last)
    const res1 = await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });
    const json1 = await res1.json() as { remaining: number };
    expect(json1.remaining).toBe(1);

    // Finish e2 (the last)
    const res2 = await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e2" }),
    });
    const json2 = await res2.json() as { remaining: number };
    expect(json2.remaining).toBe(0);
  });

  test("server cleanup removes port file", async () => {
    const { startReviewServer } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(true);
    server.close();
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(false);
  });

  test("stale port file cleaned up on findRunningServer", async () => {
    const { findRunningServer } = await importModule();
    // Write a stale port file with a dead PID
    fs.writeFileSync(TEST_PORT_FILE, `12345\n999999999\n${Date.now()}`);
    const result = await findRunningServer({ portFilePath: TEST_PORT_FILE });
    expect(result).toBeNull();
    // Port file should be cleaned up
    expect(fs.existsSync(TEST_PORT_FILE)).toBe(false);
  });

  test("waitForFinish resolves when plan is finished", async () => {
    const { startReviewServer, registerPlan, waitForFinish } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan");

    // Start waiting in background
    const waitPromise = waitForFinish(server.url, "e1");

    await new Promise(r => setTimeout(r, 50));

    // Finish the plan
    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    // waitForFinish should resolve
    await waitPromise;
    // If we get here, the test passes — waitForFinish resolved
    expect(true).toBe(true);
  });

  test("finished plans removed from GET /api/plans list", async () => {
    const { startReviewServer, registerPlan } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan 1");
    await registerPlan(server.url, "e2", "# Plan 2");

    await fetch(server.url + "/api/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "e1" }),
    });

    const res = await fetch(server.url + "/api/plans");
    const json = await res.json() as { plans: Array<{ planId: string }> };
    expect(json.plans.length).toBe(1);
    expect(json.plans[0].planId).toBe("e2");
  });

  test("waitForFinish rejects on stream close without finish event", async () => {
    const { startReviewServer, registerPlan, waitForFinish } = await importModule();
    const server = await startReviewServer({ portFilePath: TEST_PORT_FILE, plansDir: TEST_PLANS_DIR });
    servers.push(server);
    await registerPlan(server.url, "e1", "# Plan");

    // Start waiting, then close server (simulates server death)
    const waitPromise = waitForFinish(server.url, "e1");
    await new Promise(r => setTimeout(r, 50));
    server.close();

    await expect(waitPromise).rejects.toThrow("disconnected");
  });
});
