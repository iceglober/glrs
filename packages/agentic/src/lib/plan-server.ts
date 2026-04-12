import http from "node:http";
import { renderPlanPage } from "./plan-html.js";
import { appendFeedback, loadFeedback } from "./plan-feedback.js";

export interface PlanReviewServer {
  url: string;
  port: number;
  close: () => void;
}

export function startPlanReviewServer(opts: {
  planId: string;
  planContent: string;
  port?: number;
}): Promise<PlanReviewServer> {
  return new Promise((resolve, reject) => {
    const port = opts.port ?? 0;
    let cachedHtml: string | null = null;

    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        if (!cachedHtml) {
          const addr = server.address() as { port: number };
          cachedHtml = renderPlanPage(opts.planContent, opts.planId, addr.port);
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(cachedHtml);
        return;
      }

      if (req.method === "POST" && req.url === "/api/feedback") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          try {
            const data = JSON.parse(body);
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
            appendFeedback(opts.planId, data.step, data.text.trim());
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
          }
        });
        return;
      }

      if (req.method === "GET" && req.url === "/api/feedback") {
        const content = loadFeedback(opts.planId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ content }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });

    server.on("error", reject);

    server.listen(port, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://localhost:${addr.port}`,
        port: addr.port,
        close: () => server.close(),
      });
    });
  });
}
