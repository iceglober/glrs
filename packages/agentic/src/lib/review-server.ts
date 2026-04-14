import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { marked } from "marked";
import { getSetting, setSetting } from "./settings.js";
import { appendFeedback, loadFeedback } from "./plan-feedback.js";
import { renderReviewPage } from "./review-html.js";
import { sanitizeHtml } from "./sanitize-html.js";

export interface ReviewServer {
  url: string;
  port: number;
  close: () => void;
}

export interface ReviewServerOpts {
  port?: number;
  portFilePath?: string;
  plansDir?: string;
}

interface RegisteredPlan {
  planId: string;
  planContent: string;
  finished: boolean;
}

/** Default port file path. */
export const PORT_FILE_PATH = path.join(os.homedir(), ".glorious", "plan-review.port");

/** SSE connections keyed by planId. */
type SSEConnection = { res: http.ServerResponse; planId: string };

function parseBody(req: http.IncomingMessage, maxSize: number = 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    let exceeded = false;
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxSize && !exceeded) {
        exceeded = true;
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (exceeded) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/** Start a shared review server. Writes a port file for coordination. */
export function startReviewServer(opts?: ReviewServerOpts): Promise<ReviewServer> {
  return new Promise((resolve, reject) => {
    const port = opts?.port ?? 0;
    const portFilePath = opts?.portFilePath ?? PORT_FILE_PATH;
    const plans: RegisteredPlan[] = [];
    const sseConnections: SSEConnection[] = [];

    function broadcastSSE(event: string, data: any, filterPlanId?: string) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const conn of sseConnections) {
        if (!filterPlanId || conn.planId === filterPlanId) {
          try { conn.res.write(msg); } catch {}
        }
      }
    }

    function broadcastSSEAll(event: string, data: any) {
      const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const conn of sseConnections) {
        try { conn.res.write(msg); } catch {}
      }
    }

    const server = http.createServer(async (req, res) => {
      try {
        // GET / — serve HTML page
        if (req.method === "GET" && req.url === "/") {
          const planData = plans
            .filter(p => !p.finished)
            .map(p => ({
              planId: p.planId,
              htmlContent: sanitizeHtml(marked(p.planContent) as string),
            }));
          const addr = server.address() as { port: number };
          const html = renderReviewPage(planData, addr.port);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return;
        }

        // POST /api/plans — register a plan
        if (req.method === "POST" && req.url === "/api/plans") {
          const data = await parseBody(req);
          if (!data.planId || typeof data.planId !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing planId" }));
            return;
          }
          if (!data.planContent || typeof data.planContent !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing planContent" }));
            return;
          }
          // Upsert: replace if already registered
          const existing = plans.findIndex(p => p.planId === data.planId);
          if (existing >= 0) {
            plans[existing] = { planId: data.planId, planContent: data.planContent, finished: false };
          } else {
            plans.push({ planId: data.planId, planContent: data.planContent, finished: false });
          }
          broadcastSSEAll("new-plan", { planId: data.planId });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // GET /api/plans — list registered plans
        if (req.method === "GET" && req.url === "/api/plans") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            plans: plans.filter(p => !p.finished).map(p => ({
              planId: p.planId,
              planContent: p.planContent,
            })),
          }));
          return;
        }

        // GET /api/plans/:id — get individual plan HTML
        const planMatch = req.url?.match(/^\/api\/plans\/([a-zA-Z0-9_-]+)$/);
        if (req.method === "GET" && planMatch) {
          const planId = decodeURIComponent(planMatch[1]);
          const plan = plans.find(p => p.planId === planId && !p.finished);
          if (!plan) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Plan not found" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            planId: plan.planId,
            htmlContent: sanitizeHtml(marked(plan.planContent) as string),
          }));
          return;
        }

        // POST /api/feedback — save feedback for a plan
        if (req.method === "POST" && req.url === "/api/feedback") {
          const data = await parseBody(req);
          if (!data.planId || typeof data.planId !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing planId" }));
            return;
          }
          if (!data.step || typeof data.step !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing step" }));
            return;
          }
          if (!data.text || typeof data.text !== "string" || data.text.trim() === "") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing or empty text" }));
            return;
          }
          appendFeedback(data.planId, data.step, data.text.trim());
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // GET /api/feedback?planId=X — get feedback for a plan
        if (req.method === "GET" && req.url?.startsWith("/api/feedback")) {
          const url = new URL(req.url, "http://localhost");
          const planId = url.searchParams.get("planId");
          if (!planId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing planId query param" }));
            return;
          }
          const content = loadFeedback(planId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ content }));
          return;
        }

        // POST /api/finish — finish a plan review
        if (req.method === "POST" && req.url === "/api/finish") {
          const data = await parseBody(req);
          if (!data.planId || typeof data.planId !== "string") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing planId" }));
            return;
          }
          const plan = plans.find(p => p.planId === data.planId && !p.finished);
          if (!plan) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Plan not found or already finished" }));
            return;
          }
          plan.finished = true;
          const remaining = plans.filter(p => !p.finished).length;

          // Notify SSE subscribers for this plan
          broadcastSSE("finish", { planId: data.planId }, data.planId);

          // If last plan, broadcast close-tab to all
          if (remaining === 0) {
            broadcastSSEAll("close-tab", {});
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, remaining }));
          return;
        }

        // GET /api/events?planId=X — SSE stream
        if (req.method === "GET" && req.url?.startsWith("/api/events")) {
          const url = new URL(req.url, "http://localhost");
          const planId = url.searchParams.get("planId") ?? "";
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          res.write("event: connected\ndata: {}\n\n");
          const conn: SSEConnection = { res, planId };
          sseConnections.push(conn);
          req.on("close", () => {
            const idx = sseConnections.indexOf(conn);
            if (idx >= 0) sseConnections.splice(idx, 1);
          });
          return;
        }

        // GET /api/first-run
        if (req.method === "GET" && req.url === "/api/first-run") {
          const firstRun = getSetting("plan.first-run-seen") !== "true";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ firstRun }));
          return;
        }

        // POST /api/first-run-dismiss
        if (req.method === "POST" && req.url === "/api/first-run-dismiss") {
          setSetting("plan.first-run-seen", "true");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // 404
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      } catch (err: any) {
        if (err.message === "Request body too large") {
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large" }));
        } else if (err.message === "Invalid JSON") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      }
    });

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const url = `http://localhost:${addr.port}`;

      // Write port file
      const dir = path.dirname(portFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(portFilePath, `${addr.port}\n${process.pid}\n${Date.now()}`);

      resolve({
        url,
        port: addr.port,
        close: () => {
          // Close all SSE connections
          for (const conn of sseConnections) {
            try { conn.res.end(); } catch {}
          }
          sseConnections.length = 0;
          server.close();
          // Remove port file
          try { fs.unlinkSync(portFilePath); } catch {}
        },
      });
    });
  });
}

/** Check if a review server is already running by reading the port file and health-checking. */
export async function findRunningServer(opts?: { portFilePath?: string }): Promise<{ url: string; port: number } | null> {
  const portFilePath = opts?.portFilePath ?? PORT_FILE_PATH;
  if (!fs.existsSync(portFilePath)) return null;

  try {
    const content = fs.readFileSync(portFilePath, "utf-8");
    const [portStr, pidStr] = content.split("\n");
    const port = parseInt(portStr, 10);
    const pid = parseInt(pidStr, 10);

    if (isNaN(port) || isNaN(pid)) {
      try { fs.unlinkSync(portFilePath); } catch {}
      return null;
    }

    // Check if PID is alive
    try {
      process.kill(pid, 0);
    } catch {
      // PID is dead — stale port file
      try { fs.unlinkSync(portFilePath); } catch {}
      return null;
    }

    // Health check the server
    const url = `http://localhost:${port}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url + "/api/plans", { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return { url, port };
    } catch {
      // Server not responding — stale
      try { fs.unlinkSync(portFilePath); } catch {}
      return null;
    }

    return null;
  } catch {
    return null;
  }
}

/** Register a plan on an existing review server. */
export async function registerPlan(serverUrl: string, planId: string, planContent: string): Promise<void> {
  const res = await fetch(serverUrl + "/api/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId, planContent }),
  });
  if (!res.ok) {
    throw new Error(`Failed to register plan: HTTP ${res.status}`);
  }
}

/** Wait for a plan's finish signal via SSE. Resolves when the finish event fires.
 *  Rejects if the stream closes without a finish event (server died). */
export function waitForFinish(serverUrl: string, planId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let receivedFinish = false;
    fetch(serverUrl + "/api/events?planId=" + encodeURIComponent(planId), {
      signal: controller.signal,
    })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (receivedFinish) {
              resolve();
            } else {
              reject(new Error("Review server disconnected before review was finished"));
            }
            return;
          }
          const text = decoder.decode(value);
          if (text.includes("event: finish")) {
            receivedFinish = true;
            controller.abort();
            resolve();
            return;
          }
        }
      })
      .catch((err) => {
        if (err.name === "AbortError" && receivedFinish) {
          resolve();
        } else if (err.name === "AbortError") {
          reject(new Error("Review server disconnected before review was finished"));
        } else {
          reject(err);
        }
      });
  });
}

